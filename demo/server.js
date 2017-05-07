var fetch = require('node-fetch');
var path = require('path');

var express = require('express');
var handlebars = require('express-handlebars');

var port = process.env.PORT || 3000;

var app = express();

app.engine('handlebars', handlebars({
    defaultLayout: 'main'
  })
);
app.set('view engine', 'handlebars');

app.get('/', (req, res) => {
  res.render('index', {
    product: {
      name: 'T-shirt'
    }
  });
});

app.listen(port, () => {
  console.log('Example app listening on port 3000!');
});
