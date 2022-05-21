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
const { execSync } = require("child_process");
const sleep = require('sleep').sleep;

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

// 1651548687933,2022-05-03 12:31:27,-38000,매운갈비찜,863971652035149854,,,-1350606
// 1651548826811,2022-05-03 12:33:46,-8200,커피,950051329361981500,,,-1358806

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
  "식비", "한글채널", "항아리", "수입"
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

async function autoReporter(channel) {
  var recentReportTime = 0;
  await channel.send('Auto reporter running...');
  while (true) {
    const now = new Date();
    if ((now.getTime() - recentReportTime) / 1000 >= 3600 * 24 * 7) {
      recentReportTime = now;
      const nowStrs = getDateString(now).split('-');
      const nowKey = `${nowStrs[0]}-${nowStrs[1]}`;
      const info = accInfo[channel.name];
      if (info) {
        const datas = info.datas;
        if (datas && datas.length > 0) {
          var reportMsg = '';
          for (const data of datas) {
            const ymtemp = data.date.split('-');
            const key = `${ymtemp[0]}-${ymtemp[1]}`;
            if (nowKey == key) {
              reportMsg += `${data.date}> ${data.memo}: ${data.amount}\n`;
            }
          }
          reportMsg += `잔액: ${info.balance}`;
          if (reportMsg.length > 0) {
            const reportLines = reportMsg.split('\n');
            var lineCount = 0;
            var msg = '';
            for (var line of reportLines) {
              if (line.length == 0) {
                continue;
              }
              msg += line + '\n';
              lineCount += 1;
              if (lineCount < 15) {
                continue;
              }
              await channel.send("```\n" + msg + "\n```");
              lineCount = 0;
              msg = '';
            }
            if (lineCount > 0) {
              await channel.send("```\n" + msg + "\n```");
            }
          } else {
            await channel.send("내용 없음");  
          }
        } else {
          await channel.send("no datas");
        }
      } else {
        await channel.send("no info");
      }
    } else {
      sleep(600);
    }
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
  if (Number.isNaN(newBalance)) {
    return {
      error: "New balance is NaN: " + info.balance + ", amount: " + iAmount
    }
  }
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
    collector.on("collect", async (reaction, user) => {
      await message.reactions.removeAll()
        .catch(error => logger.log(`RBX]failed to clear reactions: ${error}`));
      await message.react(emojiCancel);
      const resbot = appendTransaction(message.channel.name, -amount, "cancel", "bot", res.rowData.ts, "");
      if (resbot.error == null) {
        await message.reply("취소됨. 현재 잔액: " + resbot.newBalance);
      } else {
        await message.react(emojiQuestion);
        await message.reply("취소 실패. 직접 입력하세요.");
      }
    });
    await message.react(okReaction);
    await message.reply("현재 잔액: " + res.newBalance);
  } else {
    await message.react(emojiQuestion);
    await message.reply(res.error);
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
    autoReporter(message.channel);
  }

  // It's also good practice to ignore any and all messages that do not start
  // with our prefix, or a bot mention.
  const prefix = new RegExp(`^<@!?${client.user.id}> |^\\${settings.prefix}`).exec(message.content);
  // This will return and stop the code from continuing if it's missing
  // our prefix (be it mention or from the settings).
  if (!prefix) {
    const msgs = message.content.split(' ');
    if (msgs[0].toLowerCase() == "report") {
      if (msgs.length == 3) {
        if (msgs[2].toLowerCase() == "all") {
          const inkey = msgs[1];
          const info = accInfo[message.channel.name];
          if (info) {
            const datas = info.datas;
            if (datas && datas.length > 0) {
              var reportMsg = '';
              for (const data of datas) {
                const ymtemp = data.date.split('-');
                const key = `${ymtemp[0]}-${ymtemp[1]}`;
                if (inkey == key) {
                  reportMsg += `${data.date}> ${data.memo}: ${data.amount}\n`;
                }
              }
              if (reportMsg.length > 0) {
                const reportLines = reportMsg.split('\n');
                var lineCount = 0;
                var msg = '';
                for (var line of reportLines) {
                  if (line.length == 0) {
                    continue;
                  }
                  msg += line + '\n';
                  lineCount += 1;
                  if (lineCount < 15) {
                    continue;
                  }
                  await message.reply("```\n" + msg + "\n```");
                  lineCount = 0;
                  msg = '';
                }
                if (lineCount > 0) {
                  await message.reply("```\n" + msg + "\n```");
                }
              } else {
                await message.reply("내용 없음");  
              }
            } else {
              await message.reply("no datas");
            }
          } else {
            await message.reply("no info");
          }
        } else {
          await message.reply("?, all ?");
        }
      } else if (msgs.length == 2) {
        const inkey = msgs[1];
        const info = accInfo[message.channel.name];
        if (info) {
          const datas = info.datas;
          if (datas && datas.length > 0) {
            var totalData = {};
            for (const data of datas) {
              const ymtemp = data.date.split('-');
              const key = `${ymtemp[0]}-${ymtemp[1]}`;
              if (inkey == key) {
                if (totalData[data.memo]) {
                  totalData[data.memo] += parseInt(data.amount);
                } else {
                  totalData[data.memo] = parseInt(data.amount);
                }
              }
            }
            var totalDataArray = [];
            for (const key of Object.keys(totalData)) {
              totalDataArray.push({
                memo: key,
                amount: totalData[key]
              });
            }
            totalDataArray.sort(function(a, b) {
              return b.amount - a.amount;
            });
            var reportMsg = '';
            for (const sdata of totalDataArray) {
              reportMsg += `${sdata.memo}: ${sdata.amount}원\n`;
            }
            if (reportMsg.length > 0) {
              const reportLines = reportMsg.split('\n');
              var lineCount = 0;
              var msg = '';
              for (var line of reportLines) {
                if (line.length == 0) {
                  continue;
                }
                msg += line + '\n';
                lineCount += 1;
                if (lineCount < 15) {
                  continue;
                }
                await message.reply("```\n" + msg + "\n```");
                lineCount = 0;
                msg = '';
              }
              if (lineCount > 0) {
                await message.reply("```\n" + msg + "\n```");
              }
            } else {
              await message.reply("내용 없음");  
            }
          } else {
            await message.reply("no datas");
          }
        } else {
          await message.reply("no info");
        }
      } else {
        const info = accInfo[message.channel.name];
        if (info) {
          const datas = info.datas;
          if (datas && datas.length > 0) {
            // 월별 정리
            var curkey = '';
            var insum = 0;
            var outsum = 0;
            var reportMsg = '';
            for (const data of datas) {
              const ymtemp = data.date.split('-');
              const key = `${ymtemp[0]}-${ymtemp[1]}`;
              if (curkey != key) {
                if (curkey.length > 0) {
                  reportMsg += `${curkey}> 수입: ${insum}원, 지출: ${outsum}원, 계: ${insum + outsum}원\n`;
                }
                curkey = key;
                insum = 0;
                outsum = 0;
              }
              if (data.amount > 0) {
                insum += parseInt(data.amount);
              } else {
                outsum += parseInt(data.amount);
              }
            }
            if (curkey.length > 0) {
              reportMsg += `${curkey}> 수입: ${insum}원, 지출: ${outsum}원, 계: ${insum + outsum}원`;
            }
            const reportLines = reportMsg.split('\n');
            var lineCount = 0;
            var msg = '';
            for (const line of reportLines) {
              msg += line + '\n';
              lineCount += 1;
              if (lineCount < 15) {
                continue;
              }
              await message.reply("```\n" + msg + "\n```");
              lineCount = 0;
              msg = '';
            }
            if (lineCount > 0) {
              await message.reply("```\n" + msg + "\n```");
            }
          } else {
            await message.reply("no datas");
          }
        } else {
          await message.reply("no info");
        }
      }
    } else if (msgs.length == 2) {
      const amount = parseInt(msgs[0]);
      if (!Number.isNaN(amount)) {
        const memo = msgs[1].replace(',', '/');
        if (amount < 0) {
          await message.react(emojiQuestion);
        } else {
          doTransaction(message, -amount, memo);
        }
      }
    } else if (msgs.length == 3 && msgs[0].toLowerCase() == "p") {
      const amount = parseInt(msgs[1]);
      if (!Number.isNaN(amount)) {
        const memo = msgs[2].replace(',', '/');
        if (amount < 0) {
          await message.react(emojiQuestion);
        } else {
          doTransaction(message, amount, memo);
        }
      }
    } else if (message.content.toLowerCase() == "backup") {
      const info = accInfo[message.channel.name];
      if (info) {
        const filePath = info.dataFilePath;
        // execSync(`split -C 2000 ${filePath} temp_split_`);
        const catResultLines = execSync(`cat ${filePath}`).toString().split('\n');
        var lineCount = 0;
        var msg = '';
        for (var line of catResultLines) {
          msg += line + '\n';
          lineCount += 1;
          if (lineCount < 15) {
            continue;
          }
          await message.reply("```\n" + msg + "\n```");
          lineCount = 0;
          msg = '';
        }
        if (lineCount > 0) {
          await message.reply("```\n" + msg + "\n```");
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
