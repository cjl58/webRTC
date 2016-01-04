"use strict";
var RemoteWRTC = RemoteWRTC || {};
RemoteWRTC.ConnectionManager = function() {

    var that = this;
    var _ennableConnection = true;
    this.connectionRefused = function(id){};

    this.disconnectAllPeers = function(){
        _ennableConnection = false;

        var i = RemoteWRTC.connectedPeers.length;
        while (i--) {
            RemoteWRTC.downloadManager.removePeer(RemoteWRTC.connectedPeers[i].id);
        }
        RemoteWRTC.downloadManager.removePeer("server");
    };

    this.disconnectServerPeer = function(){
        _ennableConnection = false;
        RemoteWRTC.downloadManager.removePeer("server");
    };

    this.onServerPeerDisconnected = function(){
        if(_ennableConnection === true){
            that.connectToServer();
        }
    };


    this.connectToPeers = function(){
        _ennableConnection = true;
        _initPeerConnection();
    };

    this.connectToServer = function(){
        _ennableConnection = true;
        if(RemoteWRTC.downloadManager.getPeer("server") == null && RemoteWRTC.state.state >= RemoteWRTC.Constraints.State.DOWNLOAD_SERVER_ONLY && RemoteWRTC.state.serverDownloadEnabled === true){
            var serverPeer = RemoteWRTC.PeerFactory.createServerPeer(RemoteWRTC.socketIO, RemoteWRTC.downloadManager);
            RemoteWRTC.downloadManager.addPeer(serverPeer);
        }
    };



    var _initPeerConnection = function(){
        if(RemoteWRTC.state.state <= RemoteWRTC.Constraints.State.DOWNLOAD_SERVER_ONLY || RemoteWRTC.state.online == false){
            return;
        }

        var peerToConnect = null,
            i;

        i = RemoteWRTC.connectedPeers.length;
        while(i--){
            var peerId = RemoteWRTC.connectedPeers[i].id;
            var index = $.inArray(peerId,RemoteWRTC.peerList);
            if (index == -1) {
                RemoteWRTC.removePeerFromConnectedPeers(peerId);
                if(RemoteWRTC.downloadManager) {
                    RemoteWRTC.downloadManager.removePeer(peerId); //connection close is not always proper. remove a peer if its not anymore available
                }
            }
        }

        if(RemoteWRTC.connectedPeers.length >= RemoteWRTC.Constraints.MAX_OUTGOING_CONNECTION){
            return;
        }


        var shuffledPeerList = RemoteWRTC.shuffleArray(JSON.parse(JSON.stringify(RemoteWRTC.peerList)));
        for(i = 0; i < shuffledPeerList.length; i++){
            if(RemoteWRTC.isIDInConnectedPeers(shuffledPeerList[i]) == null) {
                peerToConnect = shuffledPeerList[i];
                break;
            }
        }

        if(peerToConnect !== null){
            console.log("trying to connect to: " + peerToConnect);
            setTimeout(that.connectToPeers,100);
            var connection = new RemoteWRTC.RTCConnection();
            connection.onLocalDescriptionSet = _onLocalDescriptionSet(peerToConnect);
            connection.iceCallback = _iceCallback(peerToConnect);
            connection.channelStateChanged = _channelStateChanged(peerToConnect,"outgoing");

            connection.connect(true);
            RemoteWRTC.connectedPeers.push({id: peerToConnect, direction: "outgoing", connection: connection });
            RemoteWRTC.peerRenderer.updatePeer(peerToConnect);
        }

    };


    var _onLocalDescriptionSet = function(peerToConnect){
        return function(desr) {
            RemoteWRTC.signalerConnector.sendMessage(peerToConnect, RemoteWRTC.signalerConnector.REMOTE_DESCRIPTION, desr);
        }
    };

    var _iceCallback = function(peerToConnect){
        var numberOfCandidates = 0;
        return function(event) {
            if (event.candidate) {
                numberOfCandidates++;
                RemoteWRTC.signalerConnector.sendMessage(peerToConnect, RemoteWRTC.signalerConnector.ICE_CANDIDATE, event.candidate.candidate);
            } else {
                if(numberOfCandidates == 0){
                    throw "No candidates were created!";
                }
                console.log('End of candidates.');
            }
        }
    };

    var _channelStateChanged = function(peerToConnect, diection) {
        return function(state) {

            var conn = RemoteWRTC.isIDInConnectedPeers(peerToConnect);
            if(conn && conn.direction != diection){
                return;
            }

            if(RemoteWRTC.state.state <= RemoteWRTC.Constraints.State.DOWNLOAD_SERVER_ONLY && state != RemoteWRTC.Constraints.WebRTCConnection.CLOSED && conn){
                conn.connection.closeDataChannels();
                return;
            }

            if(conn) {
                if (state == RemoteWRTC.Constraints.WebRTCConnection.CONNECTED) {
                    if (diection == "outgoing") {
                        RemoteWRTC.controlMessenger.peerConnectedTo(peerToConnect);
                    }

                    if (RemoteWRTC.downloadManager && RemoteWRTC.downloadManager.getPeer(peerToConnect) == null) {
                        var peer = RemoteWRTC.PeerFactory.createWebRTCPeer(conn, RemoteWRTC.downloadManager);
                        RemoteWRTC.downloadManager.addPeer(peer);
                    }
                } else {


                    if (RemoteWRTC.downloadManager) {
                        console.log("removing peer, reason: state is not Connected, state: " + state);
                        RemoteWRTC.downloadManager.removePeer(peerToConnect);
                        setTimeout(that.connectToPeers, 2000);
                    }
                }
            }else{
                console.log("removing peer, reason: connection not exists");
                RemoteWRTC.downloadManager.removePeer(peerToConnect);
            }

            if(state == RemoteWRTC.Constraints.WebRTCConnection.CLOSED){
                RemoteWRTC.removePeerFromConnectedPeers(peerToConnect);
                if (conn == null || conn.direction == "outgoing") { //if outgoing or unknown
                    RemoteWRTC.controlMessenger.peerDisconnectedFrom(peerToConnect);
                }
            }

            RemoteWRTC.peerRenderer.updatePeer(peerToConnect);
        }
    };


    //Init Signaler
    this.signallerMessageCallback = function(msg){
        if(RemoteWRTC.state.state <= RemoteWRTC.Constraints.State.DOWNLOAD_SERVER_ONLY || RemoteWRTC.state.online == false){
            that.connectionRefused(msg.from);
            return;
        }
        var connection;
        switch (msg.type) {
            case RemoteWRTC.signalerConnector.ConnectionRefused:
            {
                RemoteWRTC.removePeerFromOutgoingConnectedPeers(msg.from);
            }
                break;
            case RemoteWRTC.signalerConnector.REMOTE_DESCRIPTION:
            {


                if (msg.message.type == "offer") {
                    console.log("incomming conection:" + msg.from);
                    connection = RemoteWRTC.isIDInConnectedPeers(msg.from);
                    if (connection != null ) {
                        if(msg.from < RemoteWRTC.id){
                            return;
                        }

                        RemoteWRTC.removePeerFromConnectedPeers(msg.from);

                    }

                    connection = new RemoteWRTC.RTCConnection();
                    connection.onLocalDescriptionSet = _onLocalDescriptionSet(msg.from);
                    connection.iceCallback = _iceCallback(msg.from);
                    connection.connect(false);
                    connection.setRemoteDescription(msg.message);
                    connection.channelStateChanged = _channelStateChanged(msg.from,"incoming");
                    RemoteWRTC.connectedPeers.push({
                        id: msg.from,
                        direction: "incoming",
                        connection: connection
                    });

                } else if (msg.message.type == "answer") {
                    connection = RemoteWRTC.isIDInConnectedPeers(msg.from);
                    if (connection != null) {
                        connection.connection.setRemoteDescription(msg.message);
                    } else {
                        console.assert("Error: cant find connection");
                    }

                } else {
                    console.warn("undefined type:" + msg.message.type);
                }
            }
                break;
            case RemoteWRTC.signalerConnector.ICE_CANDIDATE:
            {
                connection = RemoteWRTC.isIDInConnectedPeers(msg.from);
                if (connection != null) {
                    connection.connection.addIceCandidate(msg.message);
                } else {
                    console.log("Error: cant find connection");
                }
            }
                break;
        }


    };


};