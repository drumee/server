#!/usr/bin/env node

// ================================  *
//   Copyright Xialia.com  2013-2017 *
//   FILE  : src/offline/factory.hub
//   TYPE  : module
// ================================  *

const Minimist = require('minimist');
const { exit } = require('process');
const { archive } = require('@drumee/server-essentials/lex/script');
const { resolve, join } = require('path');
const { existsSync, symlinkSync, mkdirSync } = require("fs");
const Moment = require('moment');
const {
  RedisStore, Mariadb, Attr, Constants, Offline, sysEnv
} = require('@drumee/server-essentials');
const { isEmpty, isString, isArray } = require('lodash');
const { tmp_dir } = sysEnv();

const { DOWNLOAD_FOLDER } = Constants;

class __offline_media_zip extends Offline {

  // ========================
  // initialize
  // ========================
  initialize() {
    const argv = Minimist(process.argv.slice(2));
    this.yp = new Mariadb({ user: process.env.USER });
    let data;
    try {
      data = JSON.parse(argv._[0]);
    } catch (e) {
      data = {
        lang: 'en',
        username: "Team Drumee"
      };
    }

    this.lang = data.lang;
    this.uid = data.uid;
    this.zipid = data.zipid;
    this.nodes = data.nodes;
    this.socket_id = data.socket_id;
    this.timestamp = Moment(Moment.now() / 1000, 'X').format("YYYY-MM-DD hh:mm");
    for (let name of ['lang', 'uid', 'zipid', 'socket_id']) {
      if (isEmpty(this[name])) {
        let msg = `attribute *${name}* must bet set`;
        this.stop(msg);
      }
    }
    if (argv.verbosity) global.verbosity = argv.verbosity;
    this.debug(`lang=${this.lang}, uid=${this.uid}, zipid=${this.zipid}, nid=${this.nid}`, this.nodes);
    let res = new RedisStore();
    res.init().then(() => {
      this.prepare()
        .then(() => {
          this.debug("Done! WIll stop later");
        })
        .catch((e) => {
          this.warn("Error raised:", e);
          exit(1);
        });
    })
  }


  /**
   * 
   * @param {*} opt 
   * @returns 
   */
  async send(model, message) {
    if (!this.socket_id) {
      console.error("Error: No destination to send to");
      return;
    }
    this._payload.model = { ...this._payload.model, ...model };
    if (message) {
      this._payload.options.message = message;
    } else if (model.message) {
      this._payload.options.message = model.message;
    }
    await RedisStore.sendData(this._payload, this.socket_id);
  }

  /**
   * 
   * @param {*} msg 
   */
  stop(msg) {
    let status = 0;
    if (isString(msg)) {
      console.error(msg);
      status = 1;
    }
    this.yp.end();
    this.clear();
    exit(status);
  }

  /**
   * 
   */
  async prepare() {
    this.data_dir = resolve(
      tmp_dir,
      DOWNLOAD_FOLDER,
      this.uid,
      this.zipid
    );
    this.sender = await this.yp.await_proc('get_user', this.uid);
    this.service = 'media.download';
    let model = {
      phase: "prepare",
      progress: 0,
      zipid: this.zipid
    };
    let options = {
      service: this.service,
      tag: this.service,
      keys: ['zipid'],
      message: 'IN_PREPARATION'
    };
    this._payload = this.payload(model, options);
    await RedisStore.sendData(this._payload, this.socket_id);

    let data = await this.get_branch_nodes();
    let files = data[0];
    this.filename = data[2].filename;
    await this.build(files);
  }

  /**
   * 
   * @param {*} nid 
   * @returns 
   */
  async get_branch_nodes() {
    let nodes = [];
    let filename = this.nodes[0].filename || `Drumee ${this.timestamp}`;
    if (isArray(this.nodes)) {
      let res = [];
      let size = 0;
      for (let n of this.nodes) {
        let hub = await this.yp.await_proc('get_hub', n.hub_id);
        let db_name = hub.db_name;
        var r = await this.yp.await_proc(`${db_name}.mfs_manifest`, n.nid, this.uid, 1);
        res = res.concat(r[0]);
        size = size + r[1].total_size;
      }
      nodes = [res, { size }, { filename }];
    } else {
      await this.send({
        exit: 1,
        phase: 'exit',
        zipid: this.zipid,
        zipname: this.zipname,
        message: "Wrong node format"
      }, Attr.error);
    }
    return nodes;
  }

  /**
   * 
   * @param {*} files 
   * @param {*} socket
   * @returns 
   */
  async build(files) {
    let dest_dir = this.data_dir;
    this.debug({ dest_dir })
    mkdirSync(dest_dir, { recursive: true });
    let dump = this.makeArchiveList(files, dest_dir);
    let count = 0;
    let length = dump.length;
    for (let k of dump) {
      if (existsSync(k.src) && !existsSync(k.dest)) {
        symlinkSync(k.src, k.dest);
      }
      count++;
      await this.send({
        phase: Attr.archive,
        zipid: this.zipid,
        message: "IN_PREPARATION",
        progress: Math.ceil(100 * (count / length))
      })
    }
    let zname = this.filename.replace(/[ \n\<\>'"\(\)\/]/g, '-');

    const { spawn } = require('child_process');
    this.zipname = zname;
    const sp = spawn(`${archive}`, [dest_dir, 'index']);
    sp.on('exit', async (s) => {
      await this.send({
        exit: s,
        phase: 'exit',
        zipid: this.zipid,
        zipname: this.zipname,
        message: "DOWNLOADING",
        finished: 1
      })
      setTimeout(this.stop.bind(this), 2000);
    });

    this.progress = 0;
    sp.stdout.on('data', async (data) => {
      let line = data.toString();
      let size = line.match(/(^.+) ([0-9]{1,3}\%).+$/);
      if (size) {
        var p = parseInt(size[2]);
        if (p > this.progress) {
          this.progress = p;
          await this.send({
            phase: Attr.archive,
            zipid: this.zipid,
            zipname: this.zipname,
            message: "BEING_CREATED",
            progress: p,
            cancelId: sp.pid
          })
        }
      }
    });
    sp.stderr.on('data', async (e) => {
      console.error("Got error", e.toString());
      await this.send({
        phase: "error",
        message: e.toString(),
      })
      this.stop("GOT ERROR");
    });
    sp.unref();
  }

}

new __offline_media_zip();

