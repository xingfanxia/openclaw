#!/usr/bin/env node
// Patch: Auto-chunk Telegram messages > 4000 chars into multiple sends
// Run inside the container: node /tmp/patch-telegram-chunking.js

const fs = require("fs");
const file = "/app/dist/reply-L7QaxXzW.js";
let code = fs.readFileSync(file, "utf8");

// The exact code block in handleTelegramAction's sendMessage action
const OLD = `const result = await sendMessageTelegram(to, content, {
\t\t\ttoken,
\t\t\taccountId: accountId ?? void 0,
\t\t\tmediaUrl: mediaUrl || void 0,
\t\t\tbuttons,
\t\t\treplyToMessageId: replyToMessageId ?? void 0,
\t\t\tmessageThreadId: messageThreadId ?? void 0,
\t\t\tquoteText: quoteText ?? void 0,
\t\t\tasVoice: typeof params.asVoice === "boolean" ? params.asVoice : void 0,
\t\t\tsilent: typeof params.silent === "boolean" ? params.silent : void 0
\t\t});
\t\treturn jsonResult({
\t\t\tok: true,
\t\t\tmessageId: result.messageId,
\t\t\tchatId: result.chatId
\t\t});`;

const NEW = `const _tgSendOpts = {
\t\t\ttoken,
\t\t\taccountId: accountId ?? void 0,
\t\t\tmediaUrl: mediaUrl || void 0,
\t\t\tbuttons,
\t\t\treplyToMessageId: replyToMessageId ?? void 0,
\t\t\tmessageThreadId: messageThreadId ?? void 0,
\t\t\tquoteText: quoteText ?? void 0,
\t\t\tasVoice: typeof params.asVoice === "boolean" ? params.asVoice : void 0,
\t\t\tsilent: typeof params.silent === "boolean" ? params.silent : void 0
\t\t};
\t\tlet result;
\t\tif (content.length <= 4000 || mediaUrl) {
\t\t\tresult = await sendMessageTelegram(to, content, _tgSendOpts);
\t\t} else {
\t\t\tconst _chunks = []; let _buf = '';
\t\t\tfor (const _line of content.split('\\n')) {
\t\t\t\tif (_buf.length + _line.length + 1 > 4000 && _buf.length > 0) {
\t\t\t\t\t_chunks.push(_buf); _buf = _line;
\t\t\t\t} else {
\t\t\t\t\t_buf = _buf ? _buf + '\\n' + _line : _line;
\t\t\t\t}
\t\t\t}
\t\t\tif (_buf) _chunks.push(_buf);
\t\t\tif (_chunks.length === 0) _chunks.push(content.slice(0, 4000));
\t\t\tfor (let _i = 0; _i < _chunks.length; _i++) {
\t\t\t\tconst _co = _i === 0 ? _tgSendOpts : { ..._tgSendOpts, replyToMessageId: void 0, quoteText: void 0, buttons: void 0 };
\t\t\t\tresult = await sendMessageTelegram(to, _chunks[_i], _co);
\t\t\t}
\t\t}
\t\treturn jsonResult({
\t\t\tok: true,
\t\t\tmessageId: result.messageId,
\t\t\tchatId: result.chatId
\t\t});`;

if (code.includes(OLD)) {
  code = code.replace(OLD, NEW);
  fs.writeFileSync(file, code);
  console.log("[patch] Telegram auto-chunking applied successfully");
  console.log("[patch] Messages > 4000 chars will be split at newline boundaries");
} else {
  console.log("[patch] WARNING: Could not find target code block");
  console.log(
    "[patch] The dist file may have been updated. Check reply-L7QaxXzW.js around line 17799",
  );
}
