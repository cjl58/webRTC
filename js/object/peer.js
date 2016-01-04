"use strict"

function RtcPeer(){
  //所在房间
  this.room = "";
  //接收文件时用于暂存接收文件
  this.fileData = {};
  //本地WebSocket连接
  this.socket = null;
  //本地socket的id，由后台服务器创建
  this.socketId = null;
  //保存所有与本地相连的peer connection， 键为socket id，值为PeerConnection类型
  this.peerConnections = {};
  //保存所有与本地连接的cloud peer socket id
  this.peerList = [];
  //保存所有与本地连接的mission control peer socket id
  this.missionControlPeerList = [];

  //初始时需要构建链接的数目
  this.numStreams = 0;
  //初始时已经连接的数目
  this.initializedStreams = 0;
  //保存所有的data channel，键为socket id，值通过PeerConnection实例的createChannel创建
  this.dataChannels = {};
  //保存所有发文件的data channel及其发文件状态
  this.fileChannels = {};
  //保存所有接受到的文件
  this.receiveFiles = {};
  //define packet Size
  this.packetSize = 1000;

  //save the config and constrain parameter for the create of peerconnection
  this.pcConfig = {"iceServers": [{"url": "stun:stun.l.google.com:19302"},
                                       {"url": "stun:stun1.l.google.com:19302"},
                                       {"url": "stun:stun.schlund.de"},
                                       {"url": "stun:stun.rixtelecom.se"}
                                      ]
                       };
  this.pcConstrain = null;

}

RtcPeer.prototype.constructor = RtcPeer;

RtcPeer.prototype.connectToServer = function(){
  var socket;
	socket = this.socket = io.connect();
  var that = this;
  var REMOTE_DESCRIPTION = 10;
  var ICE_CANDIDATE = 20;
  var ConnectionRefused = 30;

  if(this.constructor === RtcMissionPeer){
    socket.emit("mission control");
    console.log("init a mission peer !");
  }else if(this.constructor === RtcPeer){
    socket.emit("I am a peer");
    console.log("init a  peer !");
  }else{
    console.log("error: can not find any instanc of it !");
  }
  
  socket.on("id", function (socketId){
    that.socketId = socketId;
    console.log(that.socketId);
    document.getElementById('idWell').textContent = 'My ID: '+ that.socketId;
  });
  
  socket.on("peerConToMC", function (peerID){
    //console.log("MC connect to peer: ",peerID);
  });

  socket.on("peerListUpdate", function (peerListUpdate){  
    that.peerList = peerListUpdate;
    console.log("peerList is updated", that.peerList);
  });

  socket.on("removePeer", function(socketId){
    var sendId;
    that.closePeerConnection(that.peerConnections[socketId]);
    delete that.peerConnections[socketId];
    delete that.dataChannels[socketId];
    for (sendId in that.fileChannels[socketId]) {
      that.cleanSendFile(sendId, socketId);
      //that.emit("send_file_error", new Error("Connection has been closed"), data.socketId, sendId, that.fileChannels[data.socketId][sendId].file);
    }
    delete that.fileChannels[socketId];
    //that.emit("remove_peer", socketId);
  });

  socket.on("connect_to_mission_control", function (socketId){
    console.log("Event: connect_to_mission_control : create peer connection for mission control !" , socketId);
    that.missionControlPeerList.push(socketId);
    var pc = that.createPeerConnection(socketId);
    //   i, m;
    //pc.addStream(that.localMediaStream);
  });

  socket.on("_ice_candidate", function (data){  
    console.log(" on event : _ice_candidate ", data.socketId);
    var candidate = new RTCIceCandidate(data);
    var pc = that.peerConnections[data.socketId];
    pc.addIceCandidate(candidate);

    console.log("_ice_candidate: get the candiate from peer and add candidate to the peerConnection ! successful: ",
      that.peerConnections, that.dataChannels);
    //that.emit('get_ice_candidate', candidate);
  });

  socket.on("_offer", function (data){  
    console.log(" on event : _offer ", data.socketId, that.peerConnections);
    that.receiveOffer(data.socketId, data.sdp);
  });

  socket.on("_answer", function (data){  
    console.log(" on event : _answer ", data.socketId);
    that.receiveAnswer(data.socketId, data.sdp);
  });

  
}



/***********************信令交换部分*******************************/


//向所有PeerConnection发送Offer类型信令
RtcPeer.prototype.sendOffers = function() {
  console.log("send offers: ", this.peerConnections);
  var i, m,
      pc,
      that = this,
      pcCreateOfferCbGen = function(pc, socketId) {
          return function(session_desc) {
              pc.setLocalDescription(session_desc);
              var data = {
                "sdp": session_desc,
                "socketId": socketId
              }

              that.socket.emit("__offer", data);
          };
      },
      pcCreateOfferErrorCb = function(error) {
          console.log(error);
      };
  for (i = 0, m = this.peerList.length; i < m; i++) {
      pc = this.peerConnections[this.peerList[i]];
      pc.createOffer(pcCreateOfferCbGen(pc, this.peerList[i]), pcCreateOfferErrorCb);
  }
};

//接收到Offer类型信令后作为回应返回answer类型信令
RtcPeer.prototype.receiveOffer = function(socketId, sdp) {
    //var pc = this.peerConnections[socketId];
    this.sendAnswer(socketId, sdp);
};

//发送answer类型信令
RtcPeer.prototype.sendAnswer = function(socketId, sdp) {
    var pc = this.peerConnections[socketId];

    console.log("get the current pc: " , this.peerConnections, pc, socketId);
    var that = this;
    pc.setRemoteDescription(new RTCSessionDescription(sdp));
    pc.createAnswer(function(session_desc) {
        pc.setLocalDescription(session_desc);
        var data = {
          "socketId": socketId,
          "sdp": session_desc
        }

        that.socket.emit("__answer", data);
        // that.socket.send(JSON.stringify({
        //     "eventName": "__answer",
        //     "data": {
        //         "socketId": socketId,
        //         "sdp": session_desc
        //     }
        // }));
    }, function(error) {
        console.log(error);
    });
};

//接收到answer类型信令后将对方的session描述写入PeerConnection中
RtcPeer.prototype.receiveAnswer = function(socketId, sdp) {
    console.log("receive the answer from other peers !");
    var pc = this.peerConnections[socketId];
    pc.setRemoteDescription(new RTCSessionDescription(sdp));
};


/***********************点对点连接部分*****************************/

//创建与其他用户连接的PeerConnections
RtcPeer.prototype.createPeerConnections = function() {
    var i, m;
    
    for (i = 0, m = this.peerList.length; i < m; i++) {
        console.log("socket id :",this.peerList[i]);
        this.createPeerConnection(this.peerList[i]);
    }

    console.log("created length of peerConnections: " , this.peerConnections);
};


//创建单个PeerConnection
RtcPeer.prototype.createPeerConnection = function(socketId) {
    console.log("create peer connection successful finish !");
    var that = this;
    var pcConfig = this.pcConfig;
    var pcConstrain = this.pcConstrain;
    //var pc = new PeerConnection(iceServer);
    var pc = new RTCPeerConnection(pcConfig,pcConstrain);

    this.peerConnections[socketId] = pc;

    pc.onicecandidate = function(evt) {
        if (evt.candidate)
            var data = {
              "label": evt.candidate.sdpMLineIndex,
              "candidate": evt.candidate.candidate,
              "socketId": socketId
            }

            that.socket.emit("__ice_candidate", data);

            // that.socket.emit("__ice_candidate", JSON.stringify({
            //     "data": {
            //         "label": evt.candidate.sdpMLineIndex,
            //         "candidate": evt.candidate.candidate,
            //         "socketId": socketId
            //     }
            // }));
            // that.socket.send(JSON.stringify({
            //     "eventName": "__ice_candidate",
            //     "data": {
            //         "label": evt.candidate.sdpMLineIndex,
            //         "candidate": evt.candidate.candidate,
            //         "socketId": socketId
            //     }
            // }));
        console.log("onicecandidate: network candidates become available and emit __ice_candidate!", socketId);
        //that.emit("pc_get_ice_candidate", evt.candidate, socketId, pc);
    };

    pc.onopen = function() {
        console.log("pc on open !");
        //that.emit("pc_opened", socketId, pc);
    };

    pc.onaddstream = function(evt) {
        console.log("pc.onaddStream: receive video stream from other peer and create video windows !");
        //that.emit('pc_add_stream', evt.stream, socketId, pc);
    };

    pc.ondatachannel = function(evt) {
        console.log("Event : pc on data channel !");
        that.addDataChannel(socketId, evt.channel);
        //that.emit('pc_add_data_channel', evt.channel, socketId, pc);
    };
    return pc;
};

//关闭PeerConnection连接
RtcPeer.prototype.closePeerConnection = function(pc) {
    if (!pc) return;
    pc.close();
};


/***********************数据通道连接部分*****************************/

//消息广播
RtcPeer.prototype.broadcast = function(message) {
    var socketId;
    for (socketId in this.dataChannels) {
        this.sendMessage(message, socketId);
    }
};

//发送消息方法
RtcPeer.prototype.sendMessage = function(message, socketId) {
    if (this.dataChannels[socketId].readyState.toLowerCase() === 'open') {
        console.log("sendMessage: send the message to other peer: " + message);
        this.dataChannels[socketId].send(JSON.stringify({
            type: "__msg",
            data: message
        }));
    }
};

//对所有的PeerConnections创建Data channel
RtcPeer.prototype.addDataChannels = function() {
    var connection;
    var label = "sendDataChannel";
    var dataChannelParms ={orderd:true, reliable:false};

    for (connection in this.peerConnections) {
        console.log("peer connection: ", connection);
        this.createDataChannel(connection, dataChannelParms);
    }

    console.log("check dataChannels: ", this.dataChannels);
};

//对某一个PeerConnection创建Data channel
RtcPeer.prototype.createDataChannel = function(socketId, label, dataChannelParms) {
    var pc, key, channel;
    pc = this.peerConnections[socketId];

    if (!socketId) {
        //this.emit("data_channel_create_error", socketId, new Error("attempt to create data channel without socket id"));
    }

    if (!(pc instanceof RTCPeerConnection)) {
        //this.emit("data_channel_create_error", socketId, new Error("attempt to create data channel without peerConnection"));
    }
    try {
        // var dataChannelParms ={orderd:true, reliable:false};
        channel = pc.createDataChannel(label, dataChannelParms);
        console.log("data channel label : ", label);
        //channel = pc.createDataChannel(label);
    } catch (error) {
        //this.emit("data_channel_create_error", socketId, error);
    }

    return this.addDataChannel(socketId, channel);
};

//为Data channel绑定相应的事件回调函数
RtcPeer.prototype.addDataChannel = function(socketId, channel) {
    var that = this;
    channel.onopen = function() {
        //that.emit('data_channel_opened', channel, socketId);
    };

    channel.onclose = function(event) {
        delete that.dataChannels[socketId];
        //that.emit('data_channel_closed', channel, socketId);
    };

    channel.onmessage = function(message) {
        var json;
        json = JSON.parse(message.data);
        if (json.type === '__file') {
            /*that.receiveFileChunk(json);*/
            that.parseFilePacket(json, socketId);
        } else if (json.type ==='__download_file') {
            that.parseDownloadFilePacket(json, socketId);
        } else {
            console.log("channel.onmessage: get the message from other peer mit channel: " + json.data);
            //that.emit('data_channel_message', channel, socketId, json.data);
        }
    };

    channel.onerror = function(err) {
        //that.emit('data_channel_error', channel, socketId, err);
    };

    this.dataChannels[socketId] = channel;
    return channel;
};




/**********************************************************/
/*                                                        */
/*                       文件传输                         */
/*                                                        */
/**********************************************************/

/************************公有部分************************/

//解析Data channel上的文件类型包,来确定信令类型
RtcPeer.prototype.parseFilePacket = function(json, socketId) {
    var signal = json.signal,
        that = this;
    if (signal === 'ask') {
        that.receiveFileAsk(json.sendId, json.name, json.size, socketId);
    } else if (signal === 'accept') {
        that.receiveFileAccept(json.sendId, socketId);
    } else if (signal === 'refuse') {
        that.receiveFileRefuse(json.sendId, socketId);
    } else if (signal === 'chunk') {
        that.receiveFileChunk(json.data, json.sendId, socketId, json.last, json.percent);
    } else if (signal === 'close') {
        //TODO
    }
};

//解析Data channel上的文件类型包,来确定信令类型, 专用于对文件下载的请求
RtcPeer.prototype.parseDownloadFilePacket = function(json, socketId) {
    var signal = json.signal,
        that = this;
        if (signal === 'ask_download') {
            //this mehtode is in peer.js
            that.sendDownloadList(socketId); 
            //that.receiveFileAsk(json.sendId, json.name, json.size, socketId);
        } else if (signal === 'download_list') {
            //this mehtode is in peer.js
            that.showDownloadList(json.data, socketId);
            //that.receiveFileAccept(json.sendId, socketId);
        } else if (signal === 'selected_sendId') {
            that.initSelectedFileToSend(json.sendId, socketId);
            //that.receiveFileRefuse(json.sendId, socketId);
        } else if (signal === 'chunk') {
            that.receiveSelectedFileChunk(json.data, json.sendId, socketId, json.last, json.percent);
        } else if (signal === 'close') {
            //TODO
        }
};


/***********************发送者部分***********************/


//通过Dtata channel向房间内所有其他用户广播文件
RtcPeer.prototype.shareFile = function(dom) {
    var socketId,
        that = this;
    for (socketId in that.dataChannels) {
        that.sendFile(dom, socketId);
    }
};

//向某一单个用户发送文件
RtcPeer.prototype.sendFile = function(dom, socketId) {
    var that = this,
        file,
        reader,
        fileToSend,
        sendId;
    if (typeof dom === 'string') {
        dom = document.getElementById(dom);
    }
    if (!dom) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("send_file_error", new Error("Can not find dom while sending file"), socketId);
        return;
    }
    if (!dom.files || !dom.files[0]) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("send_file_error", new Error("No file need to be sended"), socketId);
        return;
    }
    file = dom.files[0];
    that.fileChannels[socketId] = that.fileChannels[socketId] || {};
    sendId = that.getRandomString();
    fileToSend = {
        file: file,
        state: "ask"
    };
    that.fileChannels[socketId][sendId] = fileToSend;
    that.sendAsk(socketId, sendId, fileToSend);
    //that.emit("send_file", sendId, socketId, file);
};

//发送多个文件的碎片
RtcPeer.prototype.sendFileChunks = function() {
    var socketId,
        sendId,
        that = this,
        nextTick = false;
    for (socketId in that.fileChannels) {
        for (sendId in that.fileChannels[socketId]) {
            if (that.fileChannels[socketId][sendId].state === "send") {
                nextTick = true;
                that.sendFileChunk(socketId, sendId);
            }
        }
    }
    if (nextTick) {
        setTimeout(function() {
            that.sendFileChunks();
        }, 10);
    }
};


// test use the slice file example by google
RtcPeer.prototype.sendFileChunksSlice = function() {
    var socketId,
        sendId,
        that = this;

    var sliceFile = function(offset, sendId, socketId) {
      var reader = new window.FileReader();
      reader.onload = (function() {
        return function(e) {
          
          var packet = {
              type: "__file",
              signal: "chunk",
              sendId: sendId
          };
          var channel = that.dataChannels[socketId];

          if (!channel) {
              //that.cleanSendFile(sendId, socketId);
              //that.emit("send_file_error", new Error("Channel has been destoried"), socketId, sendId, fileToSend.file);
              return;
          }

          fileToSend.sendedPackets++;
          fileToSend.packetsToSend--;

          if (fileToSend.fileData.size > offset + e.target.result.byteLength) {
            packet.last = false;
            packet.percent = fileToSend.sendedPackets / fileToSend.allPackets * 100;
            window.setTimeout(sliceFile, 0, sendId, socketId, offset + that.packetSize);
          } else {
            packet.last = true;
            fileToSend.state = "end";
            //that.emit("sended_file", sendId, socketId, fileToSend.file);
            //that.cleanSendFile(sendId, socketId);
          }
          packet.data = e.target.result;

          channel.send(JSON.stringify(packet));
        };
      })(fileToSend.fileData);
      var slice = fileToSend.fileData.slice(offset, offset + that.packetSize);
      reader.readAsArrayBuffer(slice);
    };

    for (socketId in that.fileChannels) {
        for (sendId in that.fileChannels[socketId]) {
            if (that.fileChannels[socketId][sendId].state === "send") {
                var fileToSend = that.fileChannels[socketId][sendId];
                sliceFile(0, sendId, socketId);
            }
        }
    }
};

//发送某个文件的碎片
RtcPeer.prototype.sendFileChunk = function(socketId, sendId) {
    var that = this,
        packetSize = this.packetSize,
        fileToSend = that.fileChannels[socketId][sendId],
        packet = {
            type: "__file",
            signal: "chunk",
            sendId: sendId
        },
        channel;

    fileToSend.sendedPackets++;
    fileToSend.packetsToSend--;


    if (fileToSend.fileData.length > packetSize) {
        packet.last = false;
        packet.data = fileToSend.fileData.slice(0, packetSize);
        packet.percent = fileToSend.sendedPackets / fileToSend.allPackets * 100;

        updateUploadFileProcess(packet.percent);
        //that.emit("send_file_chunk", sendId, socketId, fileToSend.sendedPackets / fileToSend.allPackets * 100, fileToSend.file);
    } else {
        packet.data = fileToSend.fileData;
        packet.last = true;
        fileToSend.state = "end";
        //that.emit("sended_file", sendId, socketId, fileToSend.file);
        that.cleanSendFile(sendId, socketId);
    }



    // if (fileToSend.fileData.length > packetSize) {
    //     packet.last = false;
    //     packet.data = fileToSend.fileData.slice(0, packetSize);
    //     packet.percent = fileToSend.sendedPackets / fileToSend.allPackets * 100;

    //     updateUploadFileProcess(packet.percent);
    //     //that.emit("send_file_chunk", sendId, socketId, fileToSend.sendedPackets / fileToSend.allPackets * 100, fileToSend.file);
    // } else {
    //     packet.data = fileToSend.fileData;
    //     packet.last = true;
    //     fileToSend.state = "end";
    //     //that.emit("sended_file", sendId, socketId, fileToSend.file);
    //     that.cleanSendFile(sendId, socketId);
    // }

    channel = that.dataChannels[socketId];

    if (!channel) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("send_file_error", new Error("Channel has been destoried"), socketId, sendId, fileToSend.file);
        return;
    }
    channel.send(JSON.stringify(packet));
    fileToSend.fileData = fileToSend.fileData.slice(packet.data.length);
};

//发送文件请求后若对方同意接受,开始传输
RtcPeer.prototype.receiveFileAccept = function(sendId, socketId) {
    var that = this,
        packetSize = this.packetSize,
        fileToSend,
        reader,
        initSending = function(event, text) {
            fileToSend.state = "send";
            fileToSend.fileData = event.target.result;
            fileToSend.sendedPackets = 0;
            fileToSend.packetsToSend = fileToSend.allPackets = parseInt(fileToSend.fileData.length / packetSize, 10);
            that.sendFileChunks();
        };
    fileToSend = that.fileChannels[socketId][sendId];
    reader = new window.FileReader(fileToSend.file);
    //reader.readAsArrayBuffer(fileToSend.file);
    reader.readAsDataURL(fileToSend.file);
    reader.onload = initSending;
    //that.emit("send_file_accepted", sendId, socketId, that.fileChannels[socketId][sendId].file);
};

//发送文件请求后若对方拒绝接受,清除掉本地的文件信息
RtcPeer.prototype.receiveFileRefuse = function(sendId, socketId) {
    var that = this;
    that.fileChannels[socketId][sendId].state = "refused";
    //that.emit("send_file_refused", sendId, socketId, that.fileChannels[socketId][sendId].file);
    that.cleanSendFile(sendId, socketId);
};

//清除发送文件缓存
RtcPeer.prototype.cleanSendFile = function(sendId, socketId) {
    var that = this;
    delete that.fileChannels[socketId][sendId];
};

//发送文件请求
RtcPeer.prototype.sendAsk = function(socketId, sendId, fileToSend) {
    var that = this,
        channel = that.dataChannels[socketId],
        packet;
    if (!channel) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("send_file_error", new Error("Channel has been closed"), socketId, sendId, fileToSend.file);
    }
    packet = {
        name: fileToSend.file.name,
        size: fileToSend.file.size,
        sendId: sendId,
        type: "__file",
        signal: "ask"
    };
    channel.send(JSON.stringify(packet));
};

//获得随机字符串来生成文件发送ID
RtcPeer.prototype.getRandomString = function() {
    return (Math.random() * new Date().getTime()).toString(36).toUpperCase().replace(/\./g, '-');
};

/***********************接收者部分***********************/


//接收到文件碎片
RtcPeer.prototype.receiveFileChunk = function(data, sendId, socketId, last, percent) {
    var that = this,
        fileInfo = that.receiveFiles[sendId];
    if (!fileInfo.data) {
        fileInfo.state = "receive";
        fileInfo.data = [];
        //fileInfo.data = "";
    }
    fileInfo.data = fileInfo.data || [];
    fileInfo.data.push(data);
    //fileInfo.data = fileInfo.data || "";
    //fileInfo.data += data;

    if (last) {
        fileInfo.state = "end";
        that.showTransferedFile(sendId);
        //that.getTransferedFile(sendId);
    } else {
        //receive file : todo: Math.cell(percent)%
        console.log("update received file als percent: ", percent);
        updateUploadFileProcess(percent);
        //that.emit("receive_file_chunk", sendId, socketId, fileInfo.name, percent);
    }
};

//接收到所有文件碎片后将其组合成一个完整的文件并显示在云端可供下载
RtcPeer.prototype.showTransferedFile = function(sendId){
  var fileInfo = this.receiveFiles[sendId];
  var fileUrl = 'Click to download \'' + fileInfo.name + '\' (' + fileInfo.size +' bytes)';
  var listitem = '<li class=\"list-group-item\"><a id=\"'+sendId+'\">'+ fileUrl + '</a></li>';

  fileList.append(listitem);

  //var received = new window.Blob(fileInfo.data);
  var received = (fileInfo.data).join("");

  var downloadNode = document.getElementById(sendId); //$("#"+sendId);
  //downloadNode.href = (window.URL || window.webkitURL).createObjectURL(received);
  downloadNode.href = received;
  downloadNode.target = '_blank';
  downloadNode.download = fileInfo.name || dataURL;

  (window.URL || window.webkitURL).revokeObjectURL(downloadNode.href);
  //console.log("test list node:", downloadNode);
  //this.cleanReceiveFile(sendId);
};

//接收到发送文件请求后记录文件信息
RtcPeer.prototype.receiveFileAsk = function(sendId, fileName, fileSize, socketId) {
    var that = this;
    that.receiveFiles[sendId] = {
        socketId: socketId,
        state: "ask",
        name: fileName,
        size: fileSize
    };
    //接受到上传文件的请求，在云端弹出对话框询问
    var confirmToReceiveFile = function(sendId, socketId, fileName, fileSize) {
        //var p;
        if (window.confirm(socketId + "用户想要给你传送" + fileName + "文件，大小" + fileSize + "KB,是否接受？")) {
          that.sendFileAccept(sendId);
          // p = document.createElement("p");
          // p.innerText = "准备接收" + fileName + "文件";
          // p.id = "rf-" + sendId;
          // files.appendChild(p);
        } else {
          that.sendFileRefuse(sendId);
        }
    };

    confirmToReceiveFile(sendId, socketId, fileName, fileSize);
    //that.emit("receive_file_ask", sendId, socketId, fileName, fileSize);
};



//发送同意接收文件信令
RtcPeer.prototype.sendFileAccept = function(sendId) {
    var that = this,
        fileInfo = that.receiveFiles[sendId],
        channel = that.dataChannels[fileInfo.socketId],
        packet;
    if (!channel) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("receive_file_error", new Error("Channel has been destoried"), sendId, socketId);
    }
    packet = {
        type: "__file",
        signal: "accept",
        sendId: sendId
    };
    console.log("Send file Ask successful accepted !");
    channel.send(JSON.stringify(packet));
};

//发送拒绝接受文件信令
RtcPeer.prototype.sendFileRefuse = function(sendId) {
    var that = this,
        fileInfo = that.receiveFiles[sendId],
        channel = that.dataChannels[fileInfo.socketId],
        packet;
    if (!channel) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("receive_file_error", new Error("Channel has been destoried"), sendId, socketId);
    }
    packet = {
        type: "__file",
        signal: "refuse",
        sendId: sendId
    };
    channel.send(JSON.stringify(packet));
    that.cleanReceiveFile(sendId);
};

//清除接受文件缓存
RtcPeer.prototype.cleanReceiveFile = function(sendId) {
    var that = this;
    delete that.receiveFiles[sendId];
};




/**********************************************************/
/*                                                        */
/*        提供 mision control 文件下载功能                  */
/*                                                        */
/**********************************************************/


/*********************** cloud peer  ***********************/

//向 mission control 提供可下载文件列表
RtcPeer.prototype.sendDownloadList = function(socketId) {
    var that = this,
        channel = that.dataChannels[socketId],
        sendId,
        fileInfo,
        downloadFiles = [],
        packet;
    if (!channel) {
        // todo : show error
        //that.cleanSendFile(sendId, socketId);
        //that.emit("receive_file_error", new Error("Channel has been destoried"), sendId, socketId);
    }

    //var receiveFiles = that.receiveFiles;
    for (sendId in that.receiveFiles) {
        console.log("show the data in the receiveFiles[sendId]: "+ that.receiveFiles[sendId].data);
        fileInfo = that.receiveFiles[sendId];
        var downloadFile = {
          name: fileInfo.name,
          size: fileInfo.size,
          sendId: sendId
        }

        downloadFiles.push(downloadFile);
    }

    packet = {
        type: "__download_file",
        signal: "download_list",
        data: downloadFiles
    };

    channel.send(JSON.stringify(packet));

    console.log("Send down load file  list successful !");
};


// 初始化已选的文件以便于发送
RtcPeer.prototype.initSelectedFileToSend = function(sendId, socketId) {
    var that = this,
        dataForDownload,
        fileToSend,
        sendId;

    that.fileChannels[socketId] = that.fileChannels[socketId] || {};

    // 复制that.receiveFiles[sendId].data 并生成一个新的数组
    dataForDownload = that.receiveFiles[sendId].data.slice();

    // dataForDownload 是一个存放了一段段数据段的数组 
    fileToSend = {
        state: "send",
        fileData: dataForDownload 
    };

    fileToSend.sendedPackets = 0;
    fileToSend.packetsToSend = fileToSend.allPackets = dataForDownload.length;
    //that.sendAsk(socketId, sendId, fileToSend);
    //that.emit("send_file", sendId, socketId, file);
    that.fileChannels[socketId][sendId] = fileToSend;
    that.sendSelectedFileChunks(sendId, socketId);
};


//向 mission control 传输文件 , 每次传送一个chunk
RtcPeer.prototype.sendSelectedFileChunks = function(sendId, socketId) {
    // var socketId,
    //     sendId,
    var that = this,
        nextTick = false;

    console.log("that.fileChannels[socketId][sendId]: ", that.fileChannels[socketId][sendId]);
    if (typeof that.fileChannels[socketId][sendId] != 'undefined') {
        if(that.fileChannels[socketId][sendId].state === "send") {
            nextTick = true;
            that.sendSelectedFileChunk(socketId, sendId);
        }
    }
     
    if (nextTick) {
        setTimeout(function() {
            that.sendSelectedFileChunks(sendId, socketId);
        }, 10);
    }
};

//发送某个文件的碎片
RtcPeer.prototype.sendSelectedFileChunk = function(socketId, sendId) {
    var that = this,
        //packetSize = this.packetSize,
        fileToSend = that.fileChannels[socketId][sendId],
        packet = {
            type: "__download_file",
            signal: "chunk",
            sendId: sendId
        },
        channel;

    fileToSend.sendedPackets++;
    fileToSend.packetsToSend--;

    packet.data = fileToSend.fileData.shift();
    packet.percent = fileToSend.sendedPackets / fileToSend.allPackets * 100;

    if(fileToSend.fileData.length > 0){
        packet.last = false;
        //packet.data = fileToSend.fileData.shift();
        

        console.log("send file percent: ", packet.percent);
        //updateUploadFileProcess(packet.percent);
    } else {
        //packet.data = fileToSend.fileData.shift();
        packet.last = true;
        fileToSend.state = "end";
        //that.emit("sended_file", sendId, socketId, fileToSend.file);
        that.cleanSendFile(sendId, socketId);
    }

    channel = that.dataChannels[socketId];

    if (!channel) {
        that.cleanSendFile(sendId, socketId);
        //that.emit("send_file_error", new Error("Channel has been destoried"), socketId, sendId, fileToSend.file);
        return;
    }
    channel.send(JSON.stringify(packet));
    //fileToSend.fileData = fileToSend.fileData.slice(packet.data.length);
};





