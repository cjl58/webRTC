"use strict"

function RtcMissionPeer(){
	this.isConnectedToCloud = false;
}

//RtcMissionPeer.prototype = Object.create(RtcPeer.prototype);

RtcMissionPeer.prototype = new RtcPeer();
RtcMissionPeer.prototype.constructor = RtcMissionPeer;


RtcMissionPeer.prototype.connectToCloud  = function(){
  //1.create RTCPeerConnection between Mission Control and storage peers
  //Mission control act as local peerconnection and peer act as remote peerconnection
  //2.create RTCDataChannel between...
  if(!this.isConnectedToCloud){
  	console.log("length of peers in cloud: ",this.peerList);
  	this.socket.emit("connect_to_cloud");
  	this.createPeerConnections();
  	this.addDataChannels();
  	this.sendOffers();    
  }  
};




/*************************************************************/
/*                                                          */
/*                  请求从云端下载文件                         */
/*                                                          */
/************************************************************/

/*********************** mission control 接收者部分  ***********************/



//向云端发送下载文件请求
RtcMissionPeer.prototype.askCloudToDownloadFile = function() {
    var socketId,
        packet,
        channel,
        that = this;

    for (socketId in that.dataChannels) {
      channel = that.dataChannels[socketId];

      packet = {
          type: "__download_file",
          signal: "ask_download"
      };
      channel.send(JSON.stringify(packet));
    }
};



//在 mission control 端显示可下载的文件列表
RtcPeer.prototype.showDownloadList = function(downloadList, socketId){
    console.log("get down load list: " , downloadList);

    updateDownloadList(downloadList, socketId);
    
};



// 选择云端文件进行下载并发送此选择信息
RtcMissionPeer.prototype.sendSelectedFileId = function(downloadList, sendId, socketId) {
    console.log("get sendId and socketId: " + sendId + "------" +socketId);
    //updateDownloadList(downloadList, socketId);
    var that = this,
        channel = that.dataChannels[socketId],
        fileName,
        fileSize,
        packet;

    for(var i = 0; i < downloadList.length; i ++){
      var fileInfo = downloadList[i];
      if(fileInfo.sendId == sendId){
        fileName = fileInfo.name;
        fileSize = fileInfo.size;
      }
    }

    // 做好接收文件的准备，初始化本地文件存储对象    
    that.receiveFiles[sendId] = {
        socketId: socketId,
        state: "ask",
        name: fileName,
        size: fileSize
    };

    if (!channel) {
        // todo : show error
        //that.cleanSendFile(sendId, socketId);
        //that.emit("receive_file_error", new Error("Channel has been destoried"), sendId, socketId);
    }

    packet = {
        type: "__download_file",
        signal: "selected_sendId",
        sendId: sendId
    };

    channel.send(JSON.stringify(packet));
    console.log("Send selected sendId successful !");
};


//接收到文件碎片
RtcMissionPeer.prototype.receiveSelectedFileChunk = function(data, sendId, socketId, last, percent) {
    var that = this,
        fileInfo = that.receiveFiles[sendId];
    if (!fileInfo.data) {
        fileInfo.state = "receive";
        fileInfo.data = [];
        //fileInfo.data = "";
    }
    fileInfo.data = fileInfo.data || [];
    fileInfo.data.push(data);
    // fileInfo.data = fileInfo.data || "";
    // fileInfo.data += data;
    updateDownloadFileProcess(percent, sendId);

    if (last) {
        fileInfo.state = "end";
        console.log("receive all the file!", percent);
        that.getTransferedFile(sendId);
        //that.getDownloadedFile(sendId);
    } else {
        //receive file : todo: Math.cell(percent)%
        console.log("update received file als percent: ", percent);
        //updateUploadFileProcess(percent);
        //that.emit("receive_file_chunk", sendId, socketId, fileInfo.name, percent);
    }
};


//接收到所有文件碎片后将其组合成一个完整的文件并自动下载
RtcMissionPeer.prototype.getTransferedFile = function(sendId) {
    var that = this,
        fileInfo = that.receiveFiles[sendId],
        hyperlink = document.createElement("a"),
        mouseEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });
    var received = (fileInfo.data).join("");
    hyperlink.href = received;
    //hyperlink.href = fileInfo.data;
    hyperlink.target = '_blank';
    hyperlink.download = fileInfo.name || dataURL;

    hyperlink.dispatchEvent(mouseEvent);
    (window.URL || window.webkitURL).revokeObjectURL(hyperlink.href);
    //that.emit("receive_file", sendId, fileInfo.socketId, fileInfo.name);
    that.cleanReceiveFile(sendId);
};













