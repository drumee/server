const { Attr, Events } = require("@drumee/server-essentials");
const { DENIED } = Events;

const yp = require("../yp");

class private_yp extends yp {
  /**
   * 
   * @param  {...any} args 
   */
  constructor(...args) {
    super(...args);
    this.special_access = this.special_access.bind(this);
    this.list_locale = this.list_locale.bind(this);
    this.update_locale = this.update_locale.bind(this);
    this.add_locale = this.add_locale.bind(this);
    this.get_locale = this.get_locale.bind(this);
    this.delete_locale = this.delete_locale.bind(this);
    this.lookup_drumates = this.lookup_drumates.bind(this);
    this.ident_exists = this.ident_exists.bind(this);
    this.email_exists = this.email_exists.bind(this);
    this.check_password = this.check_password.bind(this);
  }

  /**
   * 
   */
  async special_access() {
    let data = await this.yp.await_proc("get_visitor", this.uid);

    if (parseInt(data.remit) < 2) {
      this.warn("Improper remit");
      this.trigger(DENIED);
      return;
    }
    return this._done();
  }

  /**
   * 
   */
  check_password() {
    const pw = this.input.use(Attr.password);
    this.yp.call_proc("check_password_next", this.uid, pw, this.output.data);
  }

  /**
   * Prevent login inside a session
   */
  login() {
    let resent = this.input.use("resent");
    if (resent || !this.user.get("signed_in")) {
      this.session.login(this.input.use("vars"), this.input.use("resent"));
    } else {
      let vars = this.input.need("vars");
      let username = this.user.get(Attr.username);
      let profile = this.user.get(Attr.profile) || {};
      if ([username, profile.email, this.uid].includes(vars.ident)) {
        this.output.data({ status: "ALREADY_SIGNED_IN" });
      } else {
        this.output.data({
          status: "CROSS_SIGNED_IN",
          current: profile.email,
          uid: this.user.get(Attr.id),
          input: vars.ident,
        });
      }
    }
  }
}

module.exports = private_yp;
