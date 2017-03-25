#!/usr/bin/env node

"use strict";

var fs = require("fs");
var join = require("path").join;
var express = require("express");
var BigNumber = require("bignumber.js");
var augur = new (require("augur.js"))();
var abi = require("augur-abi");

var FREEBIE = new BigNumber("2.5");
var ETHER = new BigNumber(10).toPower(new BigNumber(18));
var DATADIR = join(process.env.HOME, ".ethereum");

var app = express();

var connectInfo = {
    http: "http://127.0.0.1:8545",
    ws: "ws://127.0.0.1:8546",
    ipc: process.env.GETH_IPC || join(DATADIR, "geth.ipc")
};
augur.connect(connectInfo);

app.get("/", function (req, res) {
    res.end("How about a free lunch?");
});

app.get("/faucet", function (req, res) {
    res.end("How about a free lunch?");
});

var hasAlreadySentTo = {};
var lastReqTime = {};
var baddies = {};
var blacklist = {};

app.get("/faucet/:address", function (req, res) {
    var ip = req.headers['x-forwarded-for'] || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    var curTime = new Date().getTime();
    if (blacklist[ip]) {
        if (curTime - blacklist[ip] < 30000) {
            return res.end("blacklisted :(");
        } else {
            blacklist[ip] = false;
        }
    }
    if (req.params.address.length < 39) return res.end(":(");
    var prevTime = lastReqTime[ip];
    console.log(req.params.address, ip, lastReqTime[ip], curTime - prevTime, baddies[ip]);
    lastReqTime[ip] = curTime;
    if (prevTime && curTime - prevTime < 2000) {
        baddies[ip] = (!baddies[ip]) ? 1 : baddies[ip] + 1;
        if (baddies[ip] > 500) {
            console.log('Blacklisted IP', ip);
            blacklist[ip] = curTime;
        }
        return res.end(":(");
    } else {
        baddies[ip] = 0;
    }
    var address = abi.format_address(req.params.address);
    if (hasAlreadySentTo[address]) return res.end("Already sent Ether to " + address);
    hasAlreadySentTo[address] = true;
    if (!augur.rpc.ipcpath) augur.connect(connectInfo);
    augur.rpc.balance(address, function (balance) {
        balance = new BigNumber(balance).dividedBy(ETHER);
        var etherToSend = FREEBIE.minus(balance);
        if (etherToSend.gt(new BigNumber(0))) {
            augur.rpc.personal("unlockAccount", [
                augur.coinbase,
                fs.readFileSync(join(DATADIR, ".password")).toString("utf8")
            ], function (unlocked) {
                if (unlocked && unlocked.error) {
                    hasAlreadySentTo[address] = false;
                    return res.end("Couldn't unlock Ethereum node.");
                }
                augur.rpc.sendEther({
                    to: address,
                    value: etherToSend.toFixed(),
                    from: augur.coinbase,
                    onSent: function (r) {
                        augur.rpc.personal("lockAccount", [augur.coinbase], function (locked) {
                            if (locked && locked.error) {
                                console.error("lockAccount failed:", locked);
                                augur.connect(connectInfo);
                                hasAlreadySentTo[address] = false;
                            }
                        });
                    },
                    onSuccess: function (r) {
                        console.log("sendEther succeeded:", r);
                        res.end("Sent " + etherToSend.toFixed() + " ether to " + address + ".");
                        hasAlreadySentTo[address] = true;
                    },
                    onFailed: function (e) {
                        console.error("sendEther failed:", e);
                        res.end("Couldn't send ether to " + address + ".");
                        hasAlreadySentTo[address] = false;
                        augur.connect(connectInfo);
                        augur.rpc.balance(augur.coinbase, function (balance) {
                            balance = new BigNumber(balance, 16).dividedBy(ETHER);
                            console.log("Coinbase", augur.coinbase, "balance:", balance.toFixed());
                            console.log("Nodes:", JSON.stringify(augur.rpc.nodes));
                            console.log("IPC: ipcpath=" + augur.rpc.ipcpath, "ipcStatus=" + augur.rpc.ipcStatus);
                            console.log("WS: wsUrl=" + augur.rpc.wsUrl, "wsStatus=" + augur.rpc.wsStatus);
                            augur.rpc.personal("lockAccount", [augur.coinbase], function (locked) {
                                if (locked && locked.error) {
                                    console.log("lockAccount failed:", locked);
                                    augur.connect(connectInfo);
                                    hasAlreadySentTo[address] = false;
                                }
                            });
                        });
                    }
                });
            });
        } else {
            res.end("Hey, you're not broke!");
        }
    });
});

var server = app.listen(process.env.FAUCET_PORT || 8888, function () {
    var host = server.address().address;
    var port = server.address().port;
    console.log("Listening on %s:%s", host, port);
});
