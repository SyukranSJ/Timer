/*
 * build.js — inlines styles.css and the three scripts into one portable file.
 * Output: standalone.html (open it anywhere, no other files needed).
 * Run: node build.js
 */
var fs = require('fs');

var read = function (f) { return fs.readFileSync(f, 'utf8'); };
var html = read('index.html');

html = html.replace('<link rel="stylesheet" href="styles.css">',
  '<style>\n' + read('styles.css') + '\n</style>');

['timer-core.js', 'bell.js', 'app.js'].forEach(function (f) {
  html = html.replace('<script src="' + f + '"></script>',
    '<script>\n' + read(f) + '\n</script>');
});

fs.writeFileSync('standalone.html', html);
console.log('standalone.html written (' + (html.length / 1024).toFixed(1) + ' KB)');
