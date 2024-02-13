var DEBUG = false;

// Format of last refresh time in storage of SCP names for a site: "SITENAMELastRefreshTime"
// Format of SCP name in storage: "SITENAMESCP###NAME"

// Current scp website
var scpWebsite;
// Settings
var scpperSettings;

// Redirects all XHR to background page via messaging API
// because in Chrome CORS can't be done from a content script
function makeXhrChrome(sender, url, callback) {
    chrome.runtime.sendMessage(
        chrome.runtime.id,
        {sender: sender, kind: "XHR", url: url},
        null,
        function (response) {
            callback(response.sender, response.text, response.success);
        }
    );
}

function makeXhrFirefox(sender, url, callback) {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function() {
        if (request.readyState == 4)
            callback(sender, request.responseText, request.status==200);
    }
    request.open("GET", url, true);
    request.send();
}

function makeXMLHttpRequest(sender, url, callback) {
    // Fuck polyfills
    if (navigator.userAgent.indexOf("Chrome") != -1) {
        makeXhrChrome(sender, url, callback);
    } else {
        makeXhrFirefox(sender, url, callback);
    }
}

// Get extension settings
function initScpperSettings() {
    chrome.storage.sync.get("scpperSettings", function (value) {
        if (!chrome.runtime.lastError)
            scpperSettings = value["scpperSettings"]
        else
            console.log("Unexpected error while retrieving SCPper settings: "+chrome.runtime.lastError.message);
    });
}

// Inject a script file into document
function injectExtensionScript(fileName, onLoadScript) {
    var myScript = document.createElement("script");
    myScript.type = "text/javascript";
    myScript.src = chrome.runtime.getURL(fileName);
    if (onLoadScript)
        myScript.setAttribute("onload", onLoadScript)
    else
        myScript.onload = function () {myScript.parentNode.removeChild(myScript)};
    document.head.appendChild(myScript);
}

// Inject script into document
function injectScript(scriptText) {
    var myScript = document.createElement("script");
    myScript.type = "text/javascript";
    myScript.text = scriptText;
    document.head.appendChild(myScript);
    myScript.parentNode.removeChild(myScript);
}

// Figure out website by URL
function identifyScpWebsite(URL) {
    for (var i=0; i<SCP_WEBSITES.length; i++)
        for (var j=0; j<SCP_WEBSITES[i].linkTemplates.length; j++) {
            var linkRegEx = new RegExp("\\bhttps?://"+SCP_WEBSITES[i].linkTemplates[j]+"[$/]");
            if (linkRegEx.test(URL)) {
                return SCP_WEBSITES[i];
            }
        }
}

// Check if we're on forum or main wiki
function checkIfForum() {
    for (var i=0; i<scpWebsite.linkTemplates.length; i++) {
        var forumRegEx = new RegExp("https?://"+scpWebsite.linkTemplates[i]+"/forum");
        if (forumRegEx.test(document.URL)) {
            return true;
        }
    }
    return false;
}

// Extracts SCP title from mainlist and places into array of objects {id, title, rating, author}
function extractScpMetadata(doc, template) {
    var list = [];
    var getNext = function (elem) {
        if (!elem)
            return null;
        if (elem.nextSibling)
            return elem.nextSibling
        else
            return getNext(elem.parentElement);
    }
    for (var i=0; i<doc.links.length; i++) {
        var link = doc.links[i];
        var href = link.attributes["href"].value;
        if ((link.nodeName.toUpperCase() == 'A') && (new RegExp(template.urlTemplate.replace("@", template.numberRegEx)+"$", "i").test(href))) {
            var scpNumber = new RegExp(template.numberRegEx+"$", "i").exec(href);
            var text = "";
            var textElem = getNext(link);
            while (textElem && (textElem.nodeName.toUpperCase() != "A") && (text.search("\n") <0)) {
                text=text+textElem.textContent;
                textElem = getNext(textElem);
            }
            if (text) {
                //console.log(`checking for title: ${text}`);
                var scpTitle = /[^\s-—].*/.exec(text);
                if (scpTitle) {
                    list.push({id: scpNumber[0].toUpperCase(), title: scpTitle[0], url: href });
		}
            }
        }
    }
    return list;
}

var cacheInProgress = [];
var waitingCallbacks = [];

// Fill SCP metadata cache
function fillScpMetadataCache(website, callback) {
    var index = cacheInProgress.indexOf(website.name)
    if (index >= 0) {
        waitingCallbacks[index].callbacks.push(callback);
        return;
    }
    index = cacheInProgress.push(website.name)-1;
    waitingCallbacks.push({website: website.name, callbacks: [callback]});
    var pages = [];
    var templates = [];
    for (i=0; i<website.articleTemplates.length; i++)
        for (j=0; j<website.articleTemplates[i].listPages.length; j++)
            if (pages.indexOf(website.articleTemplates[i].listPages[j]) < 0) {
                pages.push(website.articleTemplates[i].listPages[j]);
                templates.push(website.articleTemplates[i]);
            }
    var pagesLeft = pages.length;
    var errors = false;
    for (var i=0; i<pages.length; i++) {
        makeXMLHttpRequest(i, website.primaryLink + pages[i], function(sender, response, success) {
            var storeObj = {};
            if (success) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(response, "text/html");
                var list = extractScpMetadata(doc, templates[sender]);
                for (var j=0; j<list.length; j++) {
		    let item = list[j];
		    item.url = website.primaryLink + item.url;
		    item.rating = 0;
		    item.author = "Nobody";
                    storeObj[`${website.name}SCP${item.id}DATA`] = item;
		}
            }
            chrome.storage.local.set(storeObj, function(){
                if (chrome.runtime.lastError)
                    errors = true;
                pagesLeft--;
                if (pagesLeft == 0) {
                    if (!errors) {
                        var dateObj = {};
                        dateObj[website.name+"LastRefreshTime"] = new Date().toString();
                        chrome.storage.local.set(dateObj);
                    }
                    for (var i=0; i<waitingCallbacks[index].callbacks.length; i++)
                        waitingCallbacks[index].callbacks[i]();
                    waitingCallbacks[index] = null;
                    cacheInProgress[index] = null;
                }
            });
        });
    }
}


// Check if local cache for metadata on the specified site is filled and up-to-date. Refresh if necessary
function validateScpMetadataCache(website, callback) {
    var refreshName = website.name+"LastRefreshTime";
    chrome.storage.local.get(refreshName, function(item) {
        var needRefresh = (item[refreshName] == null);
        if (!needRefresh) {
            var now = new Date();
            var lastRefresh = new Date(item[refreshName]);
            needRefresh = now - lastRefresh > SCP_NAME_CACHE_EXPIRATION;
        }
        if (!needRefresh) {
            callback()
        } else {
            fillScpMetadataCache(website, callback);
	}
    })
}

// Get SCP article name from the mainlist
function getScpMetadata(website, number, callback) {
    validateScpMetadataCache(website, function() {
        var nameKey = `${website.name}SCP${number.toUpperCase()}DATA`;
	//console.log(`retrieving data: ${nameKey}`);
        chrome.storage.local.get(nameKey, function(item) {
	    let entry = item[nameKey]
	    console.log(`data retrieved: ${JSON.stringify(item)}`);
	    if(!entry.rating) {
                console.log(`retrieving rating ${entry.url}`);
		makeXMLHttpRequest(number, entry.url, function(sender, response, success) {
		    if(success) {
                        let parser = new DOMParser();
                        let doc = parser.parseFromString(response, "text/html");
			let contentElement = doc.getElementById(WIKI_PAGE_CONTENT_ELEMENT_ID);
			let rating = doc.getElementsByClassName("rate-points")[0].childNodes[1].innerText;
                        //console.log(`rate-points: ${rating}`);
                        entry.rating = rating;
			callback(entry);
                    }
		});
            } else {
                callback(entry);
            }
    });
  });
}
