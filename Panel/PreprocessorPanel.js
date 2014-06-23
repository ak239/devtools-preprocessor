// TODO: move functions to different files
(function() {

function preprocessorCoverage(source, url, listenerName) {
	if (preprocessorCoverage.esprima === undefined) {
		__PREFIX__;
	} else {
		esprima = preprocessorCoverage.esprima;
		estraverse = preprocessorCoverage.estraverse;
		escodegen = preprocessorCoverage.escodegen;
	}
	preprocessorCoverage.esprima = esprima;
	preprocessorCoverage.estraverse = estraverse;
	preprocessorCoverage.escodegen = escodegen;

	if (preprocessorCoverage.last_location_id === undefined)
		preprocessorCoverage.last_location_id = -1;

	String.prototype.endsWith = function(suffix) {
	    return this.indexOf(suffix, this.length - suffix.length) !== -1;
	};
	function makeInstrument(id) {
		var instrument_source = 'window.top.__profileEnable && window.top.__hits[0]++';
		var instrument = esprima.parse(instrument_source).body[0].expression;
		var id_property = instrument.right.argument.property;
		id_property.raw = id.toString();
		id_property.value = id;
		return instrument;
	}
	function addSourceUrl(location) {
		location.url = url;
		return location;
	}

	var idToLocation = {};
	var ast = esprima.parse(source, {loc:true});

	ast = estraverse.replace(ast, {
		leave: function (node, parent) {
			// if (node.type === "ReturnStatement" && node.argument === null) {
			// 	++preprocessorCoverage.last_location_id;
			// 	idToLocation[preprocessorCoverage.last_location_id] = addSourceUrl(node.loc);			
			// 	return {type: "ReturnStatement", argument: {type: "ExpressionStatement", expression: makeInstrument(preprocessorCoverage.last_location_id), loc: node.loc }};			
			// }
			if (node.type === "EmptyStatement") {
				++preprocessorCoverage.last_location_id;
				idToLocation[preprocessorCoverage.last_location_id] = addSourceUrl(node.loc);			
				return {type: "ExpressionStatement", expression: makeInstrument(preprocessorCoverage.last_location_id), loc: node.loc };			
			}
			if (node.type === "Literal" && !parent.type.endsWith("Expression") && !(parent.type === "Property" && parent.key == node)) {
				++preprocessorCoverage.last_location_id;
				idToLocation[preprocessorCoverage.last_location_id] = addSourceUrl(node.loc);
				return {expressions: [makeInstrument(preprocessorCoverage.last_location_id), node], type: "SequenceExpression", old: node, old_code: escodegen.generate(parent)};
			}
			if (node.type.endsWith("Expression") && node.type != "FunctionExpression" && !parent.type.endsWith("Expression")) {
				++preprocessorCoverage.last_location_id;
				idToLocation[preprocessorCoverage.last_location_id] = addSourceUrl(node.loc);
				return {expressions: [makeInstrument(preprocessorCoverage.last_location_id), node], type: "SequenceExpression", old: node };				
			}
		}
	});
	
	var processed_source = escodegen.generate(ast);

	var prefix = '\
window.top.__hits = window.top.__hits || new Int32Array(1024 * 1024);\n\
window.top.__profileEnable = window.top.__profileEnable !== undefined ? window.top.__profileEnable : false;\n\
window.top.__idToLocation = window.top.__idToLocation || {};\n\
window.top.__urlToSource = window.top.__urlToSource || {};\n';

  	for (id in idToLocation)
  		prefix = prefix.concat('window.top.__idToLocation[' + id + '] = ' + JSON.stringify(idToLocation[id]) + ';\n');

  	prefix = prefix.concat('window.top.__urlToSource[\'' + escape(url) + '\'] = \'' + escape(source) + '\';\n');

  	return '{\n' + prefix + '}\n' + processed_source;
}


function XHRLoadFile(name, path) {
	console.log('Loading lib: ' + name + '..');
	var req = new XMLHttpRequest();
	req.open('GET', path + name, false);
	req.send(null);
	if (req.status === 200) {
		console.log('Lib ' + name + ' loaded');
		return req.responseText;
	}
	else
		throw "Can't load lib: " + name + " with status: " + req.status;
}


function preprocessorWithLibs(preprocessor_source, libs) {
	var LIBS_PATH = 'chrome-extension://' + chrome.runtime.id + '/libs/';
	var PREFIX_PLACE = '__PREFIX__';
	var prefix = '';
	libs.forEach(function(lib_name){
		prefix += XHRLoadFile(lib_name, LIBS_PATH);
	});
	var start_prefix_place = preprocessor_source.indexOf(PREFIX_PLACE);
	// .replace doesn't work, because lib can contain dollar sign
	preprocessor_source = preprocessor_source.substring(0, start_prefix_place) + prefix + preprocessor_source.substring(start_prefix_place + PREFIX_PLACE.length);
	preprocessor_source = '(' + preprocessor_source + ')';
	return preprocessor_source;
}


function reloadWithCoverageAnalysis() {
	var preprocessor_source = preprocessorWithLibs(preprocessorCoverage.toString(), ['esprima.js', 'estraverse.js', 'escodegen.browser.js']);
  	var options = {
    	ignoreCache: true,
    	userAgent: undefined,
    	injectedScript: undefined,
    	preprocessingScript: preprocessor_source
  	};
  	chrome.devtools.inspectedWindow.reload(options);	
}


function getCoverageReport() {
	var report = {};
	for (var i = 0; i < window.top.__hits.length; ++i) {
		if (window.top.__hits[i] > 0) {
			var hits_count = window.top.__hits[i];
			var loc = window.top.__idToLocation[i];
			
			var per_url = report[loc.url] || {hits: [], lines: {}, total: 0, source: '', url: loc.url};

			per_url.hits.push({loc: loc, count: hits_count});
			if (per_url.lines[loc.start.line])
				per_url.lines[loc.start.line] += hits_count;
			else
				per_url.lines[loc.start.line] = hits_count;

			per_url.total = hits_count;
			per_url.source = __urlToSource[escape(loc.url)];

			report[loc.url] = per_url;
		}
	}
	return Object.keys(report).map(function (key) {
    	return report[key];
	});
}


function refreshCoverage() {
	var expr = getCoverageReport.toString() + '\ngetCoverageReport()';
	function onEval(report, isException) {
		if (isException)
			throw new Error('Eval failed for ' + expr, isException.value);

		refreshVisual(report);
	}
	chrome.devtools.inspectedWindow.eval(expr, onEval);	
}


function refreshVisual(report) {
	report.sort(function(a, b){ return b.total - a.total; });

	var ul_tag = document.getElementById('tabs_list');
	while (ul_tag.firstChild) { ul_tag.removeChild(ul_tag.firstChild); }

	var contents_tag = document.getElementById('tabs_content');
	while (contents_tag.firstChild) { contents_tag.removeChild(contents_tag.firstChild); }

	for (var i = 0; i < report.length; ++i) {
		// <li class="active"><a href="#lA" data-toggle="tab">Trace viewer</a></li>
		var li = document.createElement('li');
		li.setAttribute('class', (i === 0 ? ' active': ''));

		var a = document.createElement('a');
		a.setAttribute('href', '#tab-' + (i + 1));
		a.setAttribute('data-toggle', 'tab');
		a.innerHTML = report[i].url.substring(report[i].url.lastIndexOf('/')+1) + ':' + report[i].total; 

		li.appendChild(a);
		ul_tag.appendChild(li);

      	// <div class="tab-pane active" id="lA">
      	//   <textarea id="coveraged_source"></textarea>
      	// </div>
      	var div_content = document.createElement('div');
		div_content.setAttribute('class', 'tab-pane' + (i === 0 ? ' active': ''));
		div_content.setAttribute('id', 'tab-' + (i + 1));

		var textarea = document.createElement('textarea');
		textarea.value = unescape(report[i].source);
		div_content.appendChild(textarea);
		contents_tag.appendChild(div_content);

		var cm = CodeMirror.fromTextArea(textarea, {
			mode: "javascript",
			lineNumbers: true,
			gutters: ["CodeMirror-linenumbers", "hits"]
		});

		var max_hits = 0;
		var report_hits = report[i].hits;
		for (var j = 0; j < report_hits.length; ++j)
			if (report_hits[j].count > max_hits)
				max_hits = report_hits[j].count;

		var mark_count = 100;
		for (var j = 0; j < report_hits.length; ++j) {
			var loc = report_hits[j].loc;
			var hits = report_hits[j].count;
			cm.markText({line: loc.start.line - 1, ch: loc.start.column}, {line: loc.end.line - 1, ch: loc.end.column}, {className: "mark-" + Math.ceil(hits / max_hits * mark_count)});	
		}

		function makeMarker(hits) {
		  var marker = document.createElement("div");
		  marker.innerHTML = hits.toString();
		  return marker;
		}

		for (line in report[i].lines) {
			cm.setGutterMarker(parseInt(line) - 1, "hits", makeMarker(report[i].lines[line]));
		}		
	}

	// console.log(urls_list);
	// // report.sort(function(a, b){ return b.count - a.count});
	// var table = "<table id=\"sources\" cellpadding=\"0\" cellspacing=\"0\"><tbody><tr>";
	// for (var i = 0; i < urls_list.length; i++) {
 //   		if (i > 0)
 //   			table += "</tr><tr>";
 //  		table += "<td>" + urls_list[i].count + "</td>";
 //  		table += "<td><a href=\"#\">" + urls_list[i].url + "</a></td>";
	// }
	// table += "</tr></tbody></table>";
	// document.getElementById('results_info').innerHTML = table;

	// $("#sources a").on("click", function(){
	// 	refreshSourceWithCoverageQuery($(this).text());
	// });

	// var readOnlyCodeMirror = CodeMirror.fromTextArea(document.getElementById('coveraged_source'), {
 //        mode: "javascript",
 //        theme: "default",
 //        lineNumbers: true,
 //        readOnly: true
 //    });

 //    readOnlyCodeMirror.setValue("function myScript(){\nreturn 100;\n}\n");
 //    readOnlyCodeMirror.markText({line: 1, ch: 1}, {line: 1, ch: 5}, {className: 'test'});

	// var myCodeMirror = CodeMirror.fromTextArea(document.getElementById('coveraged_source'));

	// var myCodeMirror = CodeMirror(document.getElementById('results_info'), {
 //  		value: "function myScript(){return 100;}\n",
 //  		mode:  "javascript"
	// });
}


function refreshSourceWithCoverageQuery(url) {
	var expr = getCoverageReport.toString() + '\ngetCoverageReport()';
	function onEval(report, isException) {
		if (isException)
			throw new Error('Eval failed for ' + expr, isException.value);

		expr = "window.top.__urlToSource['" + escape(url) + "']";
		function onEval(source, isException) {
			if (isException)
				throw new Error('Eval failed for ' + expr, isException.value);
			refreshSourceWithCoverage(report, url, unescape(source));
		}
		chrome.devtools.inspectedWindow.eval(expr, onEval);
	}
	chrome.devtools.inspectedWindow.eval(expr, onEval);	
}


function refreshSourceWithCoverage(report, url, source) {
	report = report.filter(function(obj){
		return obj.loc.url == url;
	});

	var readOnlyCodeMirror = CodeMirror.fromTextArea(document.getElementById('coveraged_source'), {
        mode: "javascript",
        theme: "default",
        lineNumbers: true,
        readOnly: true,
        gutters: ["CodeMirror-linenumbers", "counts"]
    });

    readOnlyCodeMirror.setValue(source);

    var cm = readOnlyCodeMirror;

    function makeMarker(count) {
    	var marker = document.createElement("div");
    	marker.innerHTML = count.toString();
    	return marker;
    }

    for (var i = 0; i < report.length; ++i) {
    	cm.setGutterMarker(report[i].loc.start.line - 1, "counts", makeMarker(report[i].count));;
    	// readOnlyCodeMirror.markText({line: report[i].loc.start.line - 1, ch: report[i].loc.start.column}, 
    	// 	{line: report[i].loc.end.line - 1, ch: report[i].loc.end.column},
    	// 	{className: 'test'});
    }
}


function switchProfiler() {
  	var expr = 'window.top.__profileEnable';
	function onEval(profileEnable, isException) {
		if (isException)
			throw new Error('Eval failed for ' + expr, isException.value);
		
		var newValue = !profileEnable;
		var newInner = newValue ? 'Disable' : 'Enable';

		var expr = 'window.top.__profileEnable = ' + newValue.toString();
		chrome.devtools.inspectedWindow.eval(expr);
		document.querySelector('.switch-button').innerHTML = newInner;
		if (!newValue)
			// refreshTimeline();
			refreshCoverage();
	}
	chrome.devtools.inspectedWindow.eval(expr, onEval);		
}


function clearProfile() {
  	var expr = 'window.top.__profileLast = -1;';
	function onEval(res, isException) {
		if (isException)
			throw new Error('Eval failed for ' + expr, isException.value);
		
		refreshTimeline();
	}
	chrome.devtools.inspectedWindow.eval(expr, onEval);			
}


function listen() {
  var refreshButton = document.querySelector('.refresh-button');
  refreshButton.addEventListener('click', refreshCoverage/*refreshTimeline*/);

  var switchButton = document.querySelector('.switch-button');
  switchButton.addEventListener('click', switchProfiler);

  var clearButton = document.querySelector('.clear-button');
  clearButton.addEventListener('click', clearProfile);

  var reloadCoverageButton = document.querySelector('.reload-coverage-button');
  reloadCoverageButton.addEventListener('click', reloadWithCoverageAnalysis);
}


window.addEventListener('load', listen);


function generateMarkStyle(from, to, count) {
    var head = document.head || document.getElementsByTagName('head')[0];
    var style = document.createElement('style');
    var css = '';
	for (var i = 1; i <= count; ++i) {
		var part = i / count;
		var r = (to.r - from.r) * part + from.r;
		var g = (to.g - from.g) * part + from.g;
		var b = (to.b - from.b) * part + from.b;

		css += '.mark-' + i + ' { background: rgb(' + Math.ceil(r) + ',' + Math.ceil(g) + ',' + Math.ceil(b) +'); }\n';
	}
	style.type = 'text/css';
	if (style.styleSheet){
	  style.styleSheet.cssText = css;
	} else {
	  style.appendChild(document.createTextNode(css));
	}

	head.appendChild(style);		
}

var mark_count = 100;
generateMarkStyle({r: 251, g: 255, b: 178}, {r: 247, g: 139, b: 81}, mark_count);


})();
