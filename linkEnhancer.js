function modifyLink(link, scpSite, scpNumber) {
    let t = `SCP-${scpNumber}`;
    if(link.innerText !== t) {
        console.log(`skip link "${link.innerText}"`);
	return;
    }
    console.log(`processing link: ${scpNumber}`);
    getScpMetadata(scpSite, scpNumber, function(scp) {
        console.log(`information retrieved ${scp}`);
        if (scp)
            link.innerText =  `${t}: ${scp.title} (${scp.rating})`;
    });
}

// Add button for a popup dialog to a link
function addLinkPopupDialog(link, website, scpNumber) {
    var popupLink = document.createElement("a");
    popupLink.href = "javascript:;";
    popupLink.innerHTML = "<sup>?</sup>";
    var next = link.nextSibling;
    if (next)
        link.parentNode.insertBefore(popupLink, next)
    else
        link.parentNode.appendChild(popupLink);
}
function enhanceLinks() {
    if (!scpperSettings.linkTooltips)
        return;
    for (var i=0; i<document.links.length; i++) {
        var link = document.links[i];
        if (link.nodeName.toUpperCase() == 'A') {
            var isScp = false;
            var scpNumber;
            var scpTemplate;
            var scpSite = identifyScpWebsite(link.href);
            if (scpSite)
            {
                for (var j=0; j<(scpSite.linkTemplates.length) && !isScp; j++)
                    for (var k=scpSite.articleTemplates.length-1; k>=0; k--) {                        
                        var linkRegEx = new RegExp(scpSite.linkTemplates[j]+scpSite.articleTemplates[k].urlTemplate.replace("@", scpSite.articleTemplates[k].numberRegEx)+"$", "ig");
                        if (linkRegEx.test(link.href)) {
                            isScp = true;
                            scpTemplate = scpSite.articleTemplates[k];                            
                            scpNumber = new RegExp(scpTemplate.numberRegEx+"$", "i").exec(link.href);
                            break;
                        }
                    }
                if (isScp && scpNumber) {
                    modifyLink(link, scpSite, scpNumber[0]);
    //                addLinkPopupDialog(link, scpSite, scpNumber[0]);
                }
            }
        }
    }
}
