// ================================  *
//   Copyright Xialia.com  2013-2020 *
// ================================  *

const { Cache, RedisStore } = require("@drumee/server-essentials");
const { Session, Input, Output } = require("@drumee/server-core");

const { ERROR, START } = require("@drumee/server-essentials/lex/event");
const configs = require("./configs");
const env = configs.env();
configs.load();
const HttpServer = require("http");
const Acl = require("./router/service");

console.log(`Starting service server with verbosity = ${global.verbosity}`);

/**
 * Service handler
 * @param {*} request 
 * @param {*} response 
 */
const handler = function (request, response) {
  const input = new Input({ request, sourceName: "service" });
  const output = new Output({ response });
  let session = new Session({ input, output, env });
  // global.verbosity = env.cache.get(VERBOSITY) || process.env.verbosity || 3;

  session.once(ERROR, function (e) {
    console.error("SERVER_FAULT[47]", e);
    if (session.exception)
      session.exception.server("SESSION_FAILED");
    session.stop();
  });


  session.once(START, function () {
    // console.log("_____________ RUNNING SERVICE _____________");
    try {
      Acl.run(session);
    } catch (e) {
      console.error("Failed to run service", e);
      if (session.exception)
        session.exception.server("SERVICE_FAILED");
      session.stop();
    }
  });
};

/**
 * 
 */
function fatalError(args) {
  let { status, error, response } = args;
  status = status || 500;
  error = error || "SERVICE_RUNNER_ERROR";
  const output = new Output({ response });
  let data = {
    error_code: status,
    status,
    error,
  }
  output.add_data(data);
  output.flush();
}

let res = new RedisStore();
res
  .init()
  .then(async () => {
    global.SharedRedisStore = RedisStore;
    new Acl();
    new Cache();
    Cache.setEnv(env);
    await Cache.load();

    console.log("Cache loaded", Cache.message("_domain_name"));
    await Acl.loadModules("./acl");
    await Acl.loadPlugins();
    const http = HttpServer.createServer((request, response) => {
      try {
        handler(request, response);
      } catch (e) {
        const error = "SERVICE_ERROR";
        console.error(`ERR[95]:${error}`, e);
        fatalError({ response, error })
      }
    });
    http.listen(env.restPort);
  })
  .catch((e) => {
    console.error("EEE:69 --- Failed to start Drumee server", e);
    const error = "SERVER_PANIC";
    console.error(`ERR[104]:${error}`, e);
    fatalError({ response, error })
  });
configs.handleSignals(async () => {
  console.log("Reloading plugin");
  await Acl.loadPlugins(true);
});
