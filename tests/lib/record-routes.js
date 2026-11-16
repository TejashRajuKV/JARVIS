// Optional server preload for API coverage: record the Express routes that actually mounted.
'use strict';
const fs = require('node:fs');
const express = require('express');
const listen = express.application.listen;
express.application.listen = function (...args) {
  if (process.env.JARVIS_TEST === '1' && process.env.JARVIS_ROUTE_LOG && this._router) {
    const routes = this._router.stack.flatMap(({ route }) => route
      ? Object.keys(route.methods).flatMap(method => [route.path].flat().map(p => [method.toUpperCase(), p]))
      : []);
    fs.writeFileSync(process.env.JARVIS_ROUTE_LOG, JSON.stringify(routes));
  }
  return listen.apply(this, args);
};
