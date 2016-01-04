var os = require('os');
var static = require('node-static');
var http = require('http');
var file = new(static.Server)();
var server = http.createServer(function (req, res) {
  file.serve(req, res);
}).listen(3000);

var io = require('socket.io').listen(server);


var sockets = [];
var cloudPeerListID = [];
var missionCOntrolID = [];
// 当有新的socket创建并连入服务器
io.sockets.on('connection',function(socket) {

	/*********************** mission control peer join *******************************/
	socket.on("mission control", function (){

		console.log("Mission Control start to work");
		console.log("Mission Control: ", socket.id);
		sockets.push(socket);

		missionCOntrolID.push(socket.id);
		socket.emit("id", socket.id);
		
	});

	/*********************** cloud peer join *******************************/
	socket.on("I am a peer", function() {
		sockets.push(socket);
		socket.emit("id",socket.id);
		cloudPeerListID.push(socket.id);

		socket.broadcast.emit("peerListUpdate", cloudPeerListID);
		console.log("New peer joined: ", socket.id);
	});

	// socket.on("conToMC", function(){
	// 	console.log('Peer: '+socket.id+' want to connect with mission control');
	// 	socket.broadcast.emit("peerConToMC", socket.id);
	// 	socket.emit("peerListUpdate", peerList);
	// 	socket.emit("conToMC", MissionControlID);
	// });


	/***********************  连接关闭 删除socket *******************************/
	socket.on('disconnect',function(){
		var delID = socket.id;
		for(var i=0; i<sockets.length; i++){
			if(sockets[i].id == delID){
				sockets.splice(i,1);
				break;
			}
		}

		for(var i=0; i<cloudPeerListID.length; i++){
			if(cloudPeerListID[i] == delID){
				cloudPeerListID.splice(i,1);
				break;
			}
		}

		for(var i=0; i<missionCOntrolID.length; i++){
			if(missionCOntrolID[i] == delID){
				missionCOntrolID.splice(i,1);
				break;
			}
		}

		socket.broadcast.emit("removePeer", delID);
		socket.broadcast.emit("peerListUpdate", cloudPeerListID);
	});

	/*********************** 处理 connect to cloud 事件 *******************************/
	socket.on("connect_to_cloud", function(){
		console.log("connect_to_cloud: " , socket.id);

		for (i = 0, m = cloudPeerListID.length; i < m; i++) {
			targetSocket = getSocket(cloudPeerListID[i]);
	
			// 将云中的每个peer和mission control peer 建立连接
			if(targetSocket){
				targetSocket.emit("connect_to_mission_control", socket.id);
			}
		}
	});

	/*********************** 处理 ice_candidate 事件 *******************************/
	socket.on("__ice_candidate", function(data){
		if(data !==null){
			console.log("__ice_candidate: " , data.socketId, data);
			var targetSocket = getSocket(data.socketId);
			var targetData = {
				"label": data.label,
				"candidate": data.candidate,
				"socketId": socket.id
			}
			if (targetSocket) {
				targetSocket.emit("_ice_candidate", targetData);
			}
		}	
	});

	/*********************** 处理 offer 事件 *******************************/
	socket.on("__offer", function(data){
		console.log("__offer: " , data.socketId);
		var targetSocket = getSocket(data.socketId);
		var targetData = {
			"sdp": data.sdp,
			"socketId": socket.id
		}
		if (targetSocket) {
			targetSocket.emit("_offer", targetData);
		}
	});

	socket.on("__answer", function(data){
		console.log("__answer: " , data.socketId);
		var targetSocket = getSocket(data.socketId);
		var targetData = {
			"sdp": data.sdp,
			"socketId": socket.id
		}
		if (targetSocket) {
			targetSocket.emit("_answer", targetData);
		}
	});


	socket.on("message", function (message){
		console.log("got message")
		if (socket.id == MissionControlID){
			console.log("got message from mission control!")
		} else {
			console.log("got message from peer!");
		}
		socket.broadcast.emit("message",message);
	});

	socket.on("FileInfo", function (FileInfo){
		console.log("got file information from mission control!");
		socket.broadcast.emit("FlieInfo", FileInfo);
	});

})


function getSocket(id) {
	var i,
		curSocket;
	if (!sockets) {
		return;
	}
	for (i = sockets.length; i--;) {
		curSocket = sockets[i];
		if (id === curSocket.id) {
			return curSocket;
		}
	}
	return;
};