const logger = require("../modules/logger.js");
const { getSettings, permlevel } = require("../modules/functions.js");
const config = require("../config.js");
const os = require("os");
const fs = require("fs");
const mkdirp = require("mkdirp-sync");
const getDirName = require("path").dirname;
const csvparser = require("csv-parser");
const csvwriter = require("csv-writer").createObjectCsvWriter;
const align = require("string-align");

const baseDataPath = "/home/pi/discord_bot/account_datas/";
const csvHeaderFormat = [
  { id: "ts", title: "ts" },
  { id: "date", title: "date" },
  { id: "amount", title: "amount" },
  { id: "memo", title: "memo" },
  { id: "by", title: "by" },
  { id: "relation", title: "relation" },
  { id: "etc", title: "etc" },
  { id: "balance", title: "balance" }
];

// async function saveTo(path, csvData) {
//   const writer = csvwriter({
//     path: path,
//     header: csvHeaderFormat
//   });
//   return new Promide(resolve => {
//     writer.writeRecords(csvData)
//       .then(() => resolve());
//   });
// }

async function loadFrom(path) {
  return new Promise(resolve => {
    var datas = [];
    try {
      if (!fs.existsSync(path)) {
        mkdirp(getDirName(path));
        fs.writeFileSync(path, 'ts,date,amount,memo,by,relation,etc,balance\n');
      }
      fs.createReadStream(path)
        .pipe(csvparser())
        .on("data", (row) => {
          logger.log(row);
          const rowData = {
            "ts": parseInt(row.ts),
            "date": row.date,
            "amount": parseInt(row.amount),
            "memo": row.memo,
            "by": row.by,
            "relation": row.relation,
            "etc": row.etc,
            "balance": parseInt(row.balance)
          };
          datas.push(rowData);
        })
        .on("end", () => {
          resolve(datas);
        })
        .on("error", (error) => {
          logger.error("file load error: " + error);
          resolve(datas);
        });
    } catch {
      logger.error("exception: " + error);
      resolve(datas);
    }
  });
}

function getMonthCodesFromNow() {
  var now = new Date();
  const monthCode = `${now.getFullYear()}${align(now.getMonth() + 1, 2, 'right', '0')}`;
  now.setDate(1);
  now.setMonth(now.getMonth() - 1);
  const monthCodePrev = `${now.getFullYear()}${align(now.getMonth() + 1, 2, 'right', '0')}`;
  return {
    monthCode: monthCode,
    monthCodePrev: monthCodePrev
  };
}

const emojiOKtoMinus = "👍";
const emojiOKtoPlus = "👌";
const emojiFailed = "⛔";
const emojiCancel = "❌";
const emojiQuestion = "❓";
const channelIdGeneral = "952529231475253251";

const accountNameList = [
  "식비", "한글채널"
];

// var accInfo = {
//   "식비": {
//     "channelId": "954963149038170172",
//     "datasPrev": [],
//     "datas": []
//   }
// };
var accInfo = null;

async function firstLoadAll() {
  accInfo = {};
  for (var name of accountNameList) {
    const filePath = baseDataPath + `${name}/datas.csv`;
    const datas = await loadFrom(filePath);
    const balance = datas.length == 0 ? 0 : datas[datas.length - 1].balance;
    accInfo[name] = {
      "datas": datas,
      "balance": balance,
      "dataFilePath": filePath
    };
  }
}

function getDateString(date) {
  return `${date.getFullYear()}-${align(date.getMonth() + 1, 2, 'right', '0')}-${align(date.getDate(), 2, 'right', '0')} ${align(date.getHours(), 2, 'right', '0')}:${align(date.getMinutes(), 2, 'right', '0')}:${align(date.getSeconds(), 2, 'right', '0')}`;
}

function appendTransaction(name, amount, memo, by, relation, etc) {
  const info = accInfo[name];
  if (!info) {
    return {
      error: "Not exist name: " + name
    };
  }
  const iAmount = parseInt(amount);
  if (Number.isNaN(iAmount)) {
    return {
      error: "Wrong number: " + amount
    };
  }
  const newBalance = parseInt(info.balance) + iAmount; 
  const now = new Date();
  const rowData = {
    "ts": parseInt(now.getTime()),
    "date": getDateString(now),
    "amount": iAmount,
    "memo": memo,
    "by": by,
    "relation": relation,
    "etc": etc,
    "balance": newBalance
  };
  try {
    const rowString = `${rowData.ts},${rowData.date},${rowData.amount},${rowData.memo},${rowData.by},${rowData.relation},${rowData.etc},${rowData.balance}\n`;
    fs.appendFileSync(info.dataFilePath, rowString);
  } catch {
    logger.error("File appending exception: " + error);
    return {
      error: "File appending exception: " + error
    };
  }
  var tempDatas = info.datas;
  tempDatas.push(rowData);
  accInfo[name].datas = tempDatas;
  accInfo[name].balance = newBalance;
  return {
    rowData: rowData,
    newBalance: newBalance,
    error: null
  };
}

async function doTransaction(message, amount, memo) {
  var okReaction = emojiOKtoPlus;
  if (amount < 0) {
    okReaction = emojiOKtoMinus;
  }
  const res = appendTransaction(message.channel.name, amount, memo, message.author.id, "", "");
  if (res.error == null) {
    const filter = (reaction, user) => {
      return reaction.emoji.name === emojiCancel && user.id === message.author.id;
    };
    const collector = message.createReactionCollector({ filter, max: 1, time: 600000 });
    collector.on("collect", (reaction, user) => {
      message.reactions.cache.get(okReaction).remove()
        .catch(error => logger.log(`RBX]failed to clear reactions: ${error}`));
      message.react(emojiCancel);
      const resbot = appendTransaction(message.channel.name, -amount, "cancel", "bot", res.rowData.ts, "");
      if (resbot.error == null) {
        message.reply("취소됨. 현재 잔액: " + resbot.newBalance);
      } else {
        message.react(emojiQuestion);
        message.reply("취소 실패. 직접 입력하세요.");
      }
    });
    await message.react(okReaction);
    await message.reply("현재 잔액: " + res.newBalance);
  } else {
    await message.react(emojiQuestion);
    await message.reply(res);
  }
}



// The MESSAGE event runs anytime a message is received
// Note that due to the binding of client to every event, every event
// goes `client, other, args` when this function is run.

module.exports = async (client, message) => {
  // Grab the container from the client to reduce line length.
  const { container } = client;
  // It's good practice to ignore other bots. This also makes your bot ignore itself
  // and not get into a spam loop (we call that "botception").
  if (message.author.bot) return;

  // Grab the settings for this server from Enmap.
  // If there is no guild, get default conf (DMs)
  const settings = message.settings = getSettings(message.guild);

  // Checks if the bot was mentioned via regex, with no message after it,
  // returns the prefix. The reason why we used regex here instead of
  // message.mentions is because of the mention prefix later on in the
  // code, would render it useless.
  const prefixMention = new RegExp(`^<@!?${client.user.id}> ?$`);
  if (message.content.match(prefixMention)) {
    return message.reply(`My prefix on this guild is \`${settings.prefix}\``);
  }

  if (accInfo == null) {
    await firstLoadAll();
  }
  logger.log("RBX] " + accInfo);

  logger.log("RBX] chan id : " + message.channel.id);

  // It's also good practice to ignore any and all messages that do not start
  // with our prefix, or a bot mention.
  const prefix = new RegExp(`^<@!?${client.user.id}> |^\\${settings.prefix}`).exec(message.content);
  // This will return and stop the code from continuing if it's missing
  // our prefix (be it mention or from the settings).
  if (!prefix) {
    const msgs = message.content.split(' ');
    if (msgs.length == 2) {
      const amount = parseInt(msgs[0]);
      if (!Number.isNaN(amount)) {
        const memo = msgs[1].replace(',', '/');
        if (amount < 0) {
          await message.react(emojiQuestion);
        } else {
          doTransaction(message, -amount, memo);
        }
      }
    } else if (msgs.length == 3 && (msgs[0] == "p" || msgs[0] == "P")) {
      const amount = parseInt(msgs[1]);
      if (!Number.isNaN(amount)) {
        const memo = msgs[2].replace(',', '/');
        if (amount < 0) {
          await message.react(emojiQuestion);
        } else {
          doTransaction(message, amount, memo);
        }
      }
    }

    return;
  }
    
  // Here we separate our "command" name, and our "arguments" for the command.
  // e.g. if we have the message "+say Is this the real life?" , we'll get the following:
  // command = say
  // args = ["Is", "this", "the", "real", "life?"]
  const args = message.content.slice(prefix[0].length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();

  // If the member on a guild is invisible or not cached, fetch them.
  if (message.guild && !message.member) await message.guild.members.fetch(message.author);

  // Get the user or member's permission level from the elevation
  const level = permlevel(message);

  // Check whether the command, or alias, exist in the collections defined
  // in app.js.
  const cmd = container.commands.get(command) || container.commands.get(container.aliases.get(command));
  // using this const varName = thing OR otherThing; is a pretty efficient
  // and clean way to grab one of 2 values!
  if (!cmd) return;

  // Some commands may not be useable in DMs. This check prevents those commands from running
  // and return a friendly error message.
  if (cmd && !message.guild && cmd.conf.guildOnly)
    return message.channel.send("This command is unavailable via private message. Please run this command in a guild.");

  if (!cmd.conf.enabled) return;

  if (level < container.levelCache[cmd.conf.permLevel]) {
    if (settings.systemNotice === "true") {
      return message.channel.send(`You do not have permission to use this command.
Your permission level is ${level} (${config.permLevels.find(l => l.level === level).name})
This command requires level ${container.levelCache[cmd.conf.permLevel]} (${cmd.conf.permLevel})`);
    } else {
      return;
    }
  }

  // To simplify message arguments, the author's level is now put on level (not member so it is supported in DMs)
  // The "level" command module argument will be deprecated in the future.
  message.author.permLevel = level;
  
  message.flags = [];
  while (args[0] && args[0][0] === "-") {
    message.flags.push(args.shift().slice(1));
  }
  // If the command exists, **AND** the user has permission, run it.
  try {
    await cmd.run(client, message, args, level);
    logger.log(`${config.permLevels.find(l => l.level === level).name} ${message.author.id} ran command ${cmd.help.name}`, "cmd");
  } catch (e) {
    console.error(e);
    message.channel.send({ content: `There was a problem with your request.\n\`\`\`${e.message}\`\`\`` })
      .catch(e => console.error("An error occurred replying on an error", e));
  }
};
