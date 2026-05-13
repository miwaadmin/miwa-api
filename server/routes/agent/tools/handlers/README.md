# Agent Tool Handlers

Each Miwa agent tool lives in this folder as one CommonJS handler file named
after the tool, for example `schedule_appointment.js`.

Handlers export a single async function:

```js
module.exports = async function scheduleAppointmentHandler({
  args,
  db,
  therapistId,
  nameMap,
  send,
  rawMessage,
  resolvePatient,
}) {
  // tool implementation
};
```

The dispatcher in `../execute.js` resolves the handler from `index.js` and
passes the same context object to every tool. Shared imports that used to live
in the old dispatcher are collected in `deps.js` so extracted handlers can stay
behavior-preserving.

To add a new tool:

1. Create `handlers/<tool_name>.js`.
2. Export one async handler function with the context signature above.
3. Add `<tool_name>: require('./<tool_name>')` to `handlers/index.js`.
4. Add or update tests for the tool behavior.
