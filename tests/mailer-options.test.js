'use strict';
const assert = require('assert');
const Module = require('module');
const { createMailer } = require('../src/mailer');
const original = Module._load;
let options, message;
Module._load = function(name, ...args) {
  if (name === 'nodemailer') return { createTransport(value) { options = value; return { sendMail: async mail => { message = mail; return {}; } }; } };
  return original.call(this, name, ...args);
};
(async () => {
  try {
    assert.equal(createMailer(), null);
    assert.throws(() => createMailer({ url: 'https://smtp.example.com', from: 'quotes@example.com' }), /smtp/);
    const mailer = createMailer({ url: 'smtp://user:pass@smtp.example.com:587?requireTLS=false&socketTimeout=0', from: 'quotes@example.com' });
    const configured = new URL(options);
    assert.equal(configured.searchParams.get('requireTLS'), 'true');
    assert.equal(configured.searchParams.get('connectionTimeout'), '10000');
    assert.equal(configured.searchParams.get('greetingTimeout'), '10000');
    assert.equal(configured.searchParams.get('socketTimeout'), '20000');
    assert.equal((await mailer.send({ to: 'a@example.com,other@example.com', subject: 'Quote', text: 'Hello' })).ok, false);
    assert.equal(message, undefined);
    assert.equal((await mailer.send({ to: 'a@example.com', subject: 'Quote\r\nBcc: other@example.com', text: 'Hello' })).ok, true);
    assert(!message.subject.includes('\n'));
    createMailer({ url: 'smtps://smtp.example.com:465', from: 'quotes@example.com' });
    assert.equal(new URL(options).protocol, 'smtps:');
    const transport = { jsonTransport: true };
    createMailer({ transport, from: 'quotes@example.com' });
    assert.strictEqual(options, transport);
    console.log('ok mailer: TLS and timeout settings, recipient validation, header cleanup, test transport');
  } finally { Module._load = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
