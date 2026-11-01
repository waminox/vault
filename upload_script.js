var i=j=0,k;
var file;
var ups;
var fq = [];
var fcq = [];
var que = [];

function _(el){
    return document.getElementById(el);
}

//following function sends files in queue
function upf(){
	if(j-i == 0){
		j = j + _("file").files.length;
		k = 0;
		filesend();
	}
}

//following function makes the request to the reuest_handler.php file
function filesend(){
	var rem = j-i;
	_("status").innerHTML = rem + "file(s) remaining in uploading queue.";
	if(i<j){
		file = _("file").files[k];
		folder = document.getElementById("folderSelect").value;

		fq[i] = file.name;
		fcq[i] = 0;
		formdata = new FormData();
		formdata.append("file",file);
		formdata.append("folder",folder);
		if (navigator.appName == "Microsoft Internet Explorer") {
			ups = new ActiveXObject("Microsoft.XMLHTTP");
		}else {
			ups = new XMLHttpRequest();
		}

		crupsta();
		eventhand();
		ups.open("POST","request_handler.php");
		ups.send(formdata);
	}

}


//following function add event listeners for request sent by above Ajax function
function eventhand(){
	ups.upload.addEventListener("progress",pH,false);
	ups.addEventListener("load",cH,false);
	ups.addEventListener("error",eH,false);
	ups.addEventListener("abort",aH,false);

}

//following functions generates dynamic progress-bars in index.html
function crupsta(){
	var scon = document.createElement("div");
	var pbarocon = document.createElement("div");
	var pbaricon = document.createElement("div");
	var pbar = document.createElement("div");
	var pbart = document.createElement("span");

	var pccon = document.createElement("div");
	var pclo = document.createElement("i");

	var pte1 = document.createElement("span");
	var pte2 = document.createElement("p");
	scon.appendChild(pbarocon);
	pbarocon.appendChild(pbaricon);
	pbaricon.appendChild(pbar);
	pbar.appendChild(pbart);
	scon.appendChild(pccon);
	pccon.appendChild(pclo);
	scon.appendChild(pte2);
	scon.appendChild(pte1);
	var upfcon = document.getElementById("upfo");
	upfcon.appendChild(scon);

	scon.className = "upstacon";

	pbarocon.className = "cssProgress";
	pbaricon.className = "progress3";
	pbar.className = "cssProgress-bar cssProgress-warning cssProgress-stripes";
	pbart.className = "cssProgress-label";
	pccon.className = "upproclocon";
	pclo.className = "upproclosym fas fa-times";
	pte1.className = "upstate";
	pte2.className = "upstate2";

	var cliatt = document.createAttribute("onclick");
	cliatt.value = "proclo(this)";
	pccon.setAttributeNode(cliatt);

	pbar.style.width = "0%";

	pccon.id = "upfclo"+i;
	pbar.id = "pbar"+i;
	pte1.id = "status"+i;
	pte2.id = "lnt"+i;
	pbart.id = "per"+i;
}

function pH(e){
		if(i >= 0){
			if(que[i] === undefined && fq[i] == file.name){
				que[i]= e.total;
			}
		}

		if(e.lengthComputable && (que[i] == e.total)){
				var lnt = "lnt"+i;
				var per = "per"+i;
				var pbar = "pbar"+i;
				var sta = "status"+i;
				var load = e.loaded/1048576;
				var totl = e.total/1048576;
				loadr = load.toFixed(2);
				totlr = totl.toFixed(2);
				var percent = (e.loaded/e.total)*100;

				_(lnt).innerHTML = fq[i];
				_(per).innerHTML = Math.round(percent)+" %";
				_(pbar).style.width = percent+"%";
				_(sta).innerHTML = loadr + " MB of " + totlr + " MB uploded";
		}
}

function cH(event){
		if((_("pbar"+i).style.width == "100%") && (fcq[i]!== 1)){
			fcq[i] = 1;
			_("status"+i).innerHTML = event.target.responseText;
			_("lnt"+i).style.display = "none";
			_("upfclo"+i).style.display = "block";
			_("pbar"+i).setAttribute("style","background-color: #66bb6a !important; width: 100%;");
			k++;
			i++;
			filesend();
		}
}

function eH(event){
	fcq[i] = 1;
	_("status"+i).innerHTML = "upload failed";
	_("lnt"+i).style.display = "none";
	_("upfclo"+i).style.display = "block";
	_("pbar"+i).setAttribute("style","background-color: #66bb6a !important; width: 100%;");
	k++;
	i++;
	fref();
	filesend();
}

function aH(event){
	fcq[i] = 1;
	_("status"+i).innerHTML = "upload aborted";
	_("lnt"+i).style.display = "none";
	_("upfclo"+i).style.display = "block";
	_("pbar"+i).setAttribute("style","background-color: #66bb6a !important; width: 100%;");
	k++;
	i++;
	filesend();
}

function proclo(clob){
	var parob = _("upfo");
	var clobj = clob.parentNode;
	parob.removeChild(clobj);
}