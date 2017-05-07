import * as dom5 from 'dom5';
import * as fs from 'fs-extra';
import * as glob from 'glob';
import * as minimist from 'minimist';
import * as parse5 from 'parse5';
import * as path from 'path';
import {Analysis, Analyzer, Document, FSUrlLoader} from 'polymer-analyzer';

export interface Options { files: string[]; }
;

const analyzer = new Analyzer({
  urlLoader: new FSUrlLoader('./'),
});

const args = minimist(process.argv.slice(2));

const configLocation = path.join(process.cwd(), args.config);
const configuration: Options = require(configLocation);
const applicationFolder = path.dirname(configLocation);
const viewsPath = path.join(applicationFolder, 'views');

function relativeToCwd(file: string): string {
  return path.relative(process.cwd(), path.join(applicationFolder, file));
}

function htmlToHandlebarsExtension(file: string, extension = '.handlebars'): string {
  return file.replace(path.extname(file), extension);
}

function replaceASTNodeWithHandlebars(
    elementReference: ElementReferenceLocation, file: string) {
  const relativeHandlebar =
      path.relative(applicationFolder, file);
  const handleBar = dom5.constructors.text(
      `{{> ${htmlToHandlebarsExtension(relativeHandlebar, '')} }}`);
  dom5.replace(elementReference.node, handleBar);
}

interface ElementReferenceLocation {
  location: string;
  node: parse5.ASTNode;
}

const isCustomElement = dom5.predicates.hasMatchingTagName(/(.+-)+.+/);

function recursivelyProcessElementReferences(
    result: Analysis,
    sourceFiles: string[],
    elementReferences: ElementReferenceLocation[]) {
  while (elementReferences.length) {
    const elementReference = elementReferences.shift()!;
    const elementDefinitions = Array.from(result.getFeatures(
        {id: elementReference.node.tagName, kind: 'polymer-element'}));
    if (elementDefinitions.length === 1) {
      const elementDefinition = elementDefinitions[0];
      // Definition could not be found, we can't substitute here
      if (!elementDefinition.sourceRange) {
        continue;
      }
      const elementDefinitionFile = elementDefinition.sourceRange.file;
      // Element reference is one of the elements we have to transform
      if (sourceFiles.indexOf(elementDefinitionFile) !== -1) {
        // Recursively check the dom module, if we need to continue
        if (elementDefinition.domModule) {
          const template = dom5.query(
              elementDefinition.domModule,
              dom5.predicates.hasTagName('template'));
          if (template) {
            const templateContent =
                parse5.treeAdapters.default.getTemplateContent(template);
            const elementReferencesInDomModule =
                dom5.queryAll(templateContent, isCustomElement).map((node) => {
                  return {location: elementDefinitionFile, node: node};
                });
            elementReferences =
                elementReferences.concat(elementReferencesInDomModule);
          }
        }
        replaceASTNodeWithHandlebars(
            elementReference, elementDefinition.sourceRange.file);
      }
    }
  }
}

function outputPartialElements(sourceFiles: string[], result: Analysis) {
  for (const file of sourceFiles) {
    const document = result.getDocument(file);
    if (!(document instanceof Document)) {
      console.error('Could not find document for "{}"', file);
      process.exit(-1);
      return;
    }

    const template = dom5.query(
        document.parsedDocument.ast,
        dom5.predicates.AND(
            dom5.predicates.hasTagName('template'),
            dom5.predicates.parentMatches(
                dom5.predicates.hasTagName('dom-module'))));
    if (template) {
      const partialLocation = path.join(
          viewsPath, 'partials', path.relative(applicationFolder, file));
      const partialPath = htmlToHandlebarsExtension(partialLocation);
      fs.ensureDirSync(path.dirname(partialPath));

      fs.writeFileSync(
          partialPath,
          parse5.serialize(
              parse5.treeAdapters.default.getTemplateContent(template)));
    } else {
      const partialLocation =
          path.join(viewsPath, path.relative(applicationFolder, file));
      const partialPath = htmlToHandlebarsExtension(partialLocation);
      fs.ensureDirSync(path.dirname(partialPath));

      fs.writeFileSync(
          partialPath, parse5.serialize(document.parsedDocument.ast));
    }
  }
}

Promise
    .all(configuration.files.map(
        (filePattern) => new Promise((resolve, reject) => {
          const relativePath = relativeToCwd(filePattern);
          glob(relativePath, {nodir: true}, (err, files) => {
            if (err) {
              reject(err);
            } else {
              resolve(files);
            }
          });
        })))
    .then((relativePaths: string[]) => {
      const sourceFiles = Array.prototype.concat.apply([], relativePaths);
      const indexFile = relativeToCwd('index.html');
      analyzer.analyze(sourceFiles.concat(indexFile)).then((result) => {
        const indexResult = result.getDocument(indexFile)!;
        if (!(indexResult instanceof Document)) {
          console.error('Could not find index.html "{}"', indexFile);
          process.exit(-1);
          return;
        }

        const elementReferenceNodes =
            Array.from(indexResult.getFeatures({kind: 'element-reference'}))
                .map((reference) => {
                  return {
                    location: reference.sourceRange.file,
                    node: reference.astNode
                  };
                });
        recursivelyProcessElementReferences(
            result, sourceFiles, elementReferenceNodes);

        // Monkey patch the serializer to prevent parse5 to escape the `{{>}}`
        // format used by handlebars. For more information see
        // https://github.com/inikulin/parse5/issues/175#issuecomment-271247081
        const serializerStream: any = new parse5.SerializerStream(
            indexResult.parsedDocument.ast,
            {treeAdapter: parse5.treeAdapters.default});
        const serializer: any = serializerStream.serializer;
        serializer.constructor.escapeString = (str: any) => str;
        // End monkey patch

        outputPartialElements(sourceFiles.concat(indexFile), result);
      });
    });
