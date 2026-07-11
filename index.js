const { Telegraf } = require('telegraf');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === НАСТРОЙКИ ===
const BOT_TOKEN = '8696927422:AAGe2rDO5uDKY4Ac5B8_EDQvLYYL91ivNns'; 
const MY_TELEGRAM_ID = 6318051388; 
const BANK_BOT_USERNAME = 'GVBank_bot'; 

const TOPICS_FILE = path.join(__dirname, 'topics_db.json');
const MSGMAP_FILE = path.join(__dirname, 'msgmap_db.json');

let RP_CHAT_ID = null;
let activeTopicId = null;
let topics = new Map();
let msgMapToChat = new Map();
let msgMapToLog = new Map();

const loadDataFromDisk = () => {
    try {
        if (fs.existsSync(TOPICS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
            RP_CHAT_ID = raw.RP_CHAT_ID || null;
            activeTopicId = raw.activeTopicId !== undefined ? raw.activeTopicId : null;
            topics = new Map(Object.entries(raw.topics || {}));
        }
        if (fs.existsSync(MSGMAP_FILE)) {
            const raw = JSON.parse(fs.readFileSync(MSGMAP_FILE, 'utf8'));
            msgMapToChat = new Map(Object.entries(raw.toChat || {}));
            msgMapToLog = new Map(Object.entries(raw.toLog || {}));
        }
    } catch (e) { console.error('Ошибка загрузки БД:', e); }
};

const saveDataToDisk = () => {
    try {
        fs.writeFileSync(TOPICS_FILE, JSON.stringify({ RP_CHAT_ID, activeTopicId, topics: Object.fromEntries(topics) }, null, 2), 'utf8');
        fs.writeFileSync(MSGMAP_FILE, JSON.stringify({ toChat: Object.fromEntries(msgMapToChat), toLog: Object.fromEntries(msgMapToLog) }, null, 2), 'utf8');
    } catch (e) { console.error('Ошибка записи БД:', e); }
};

loadDataFromDisk();

// Сервер-заглушка
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Emilia Online\n');
}).listen(PORT);

const bot = new Telegraf(BOT_TOKEN);

const getTopicsKeyboard = () => {
    if (topics.size === 0) return null;
    const buttons = [];
    for (const [id, name] of topics.entries()) {
        const prefix = Number(id) === Number(activeTopicId) ? '🟢 ' : '⚪ ';
        buttons.push([{ text: `${prefix}${name}`, callback_data: `select_topic:${id}` }]);
    }
    return { inline_keyboard: buttons };
};

// Переключение тем
bot.on('callback_query', async (ctx) => {
    if (ctx.callbackQuery.data.startsWith('select_topic:')) {
        const topicId = ctx.callbackQuery.data.split(':')[1];
        activeTopicId = topicId === '0' ? 0 : Number(topicId);
        saveDataToDisk();
        await ctx.answerCbQuery(`Тема: ${topics.get(activeTopicId)}`);
        await ctx.editMessageText(`Вы переключились на тему: **${topics.get(activeTopicId)}**`, { parse_mode: 'Markdown', reply_markup: getTopicsKeyboard() });
    }
});

bot.command('menu', async (ctx) => {
    if (ctx.from.id === MY_TELEGRAM_ID && RP_CHAT_ID) {
        await ctx.reply('Выберите активную тему:', { reply_markup: getTopicsKeyboard() });
    }
});

// СИНХРОНИЗАЦИЯ РЕАКЦИЙ С ДИСКА
bot.on('message_reaction', async (ctx) => {
    if (ctx.chat.type !== 'private' || ctx.from.id !== MY_TELEGRAM_ID) return;
    const logMsgId = ctx.messageReaction.message_id.toString();
    const targetGroupId = msgMapToChat.get(logMsgId);
    if (targetGroupId && RP_CHAT_ID) {
        try {
            const reactions = ctx.messageReaction.new_reaction.map(r => {
                if (r.type === 'custom_emoji') return { type: 'custom_emoji', custom_emoji_id: r.custom_emoji_id };
                return { type: 'emoji', emoji: r.emoji };
            });
            await ctx.telegram.setMessageReaction(RP_CHAT_ID, Number(targetGroupId), reactions);
        } catch (e) { console.error('Ошибка реакции:', e); }
    }
});

// ОБЩАЯ ФУНКЦИЯ ЛОГИРОВАНИЯ ИЗ ГРУППЫ В ЛИЧКУ
async function logGroupMessageToUser(ctx, msg, isTextOnly) {
    RP_CHAT_ID = ctx.chat.id;
    const currentTopicId = msg.message_thread_id || 0;

    // Регистрация тем
    if (msg.reply_to_message && msg.reply_to_message.forum_topic_created) {
        topics.set(currentTopicId, msg.reply_to_message.forum_topic_created.name);
        saveDataToDisk();
    } else if (!topics.has(currentTopicId)) {
        topics.set(currentTopicId, `Тема #${currentTopicId || 'Главная'}`);
        saveDataToDisk();
    }
    if (activeTopicId === null) {
        activeTopicId = currentTopicId;
        saveDataToDisk();
    }

    // Проверяем отправителя
    const isFromBank = msg.from.is_bot && msg.from.username === BANK_BOT_USERNAME;
    const isFromOtherUser = !msg.from.is_bot && msg.from.id !== MY_TELEGRAM_ID;

    // Сюда попадают ТОЛЬКО сообщения из активной темы от других игроков или банка
    if ((isFromOtherUser || isFromBank) && currentTopicId === activeTopicId) {
        try {
            const senderName = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
            let replyInfo = '';
            
            if (msg.reply_to_message && !msg.reply_to_message.forum_topic_created) {
                const origSender = msg.reply_to_message.from;
                const origName = origSender.username ? `@${origSender.username}` : origSender.first_name;
                replyInfo = ` (в ответ на ${origName})`;
            }

            const forwardHeader = `💬 **${senderName}**${replyInfo} в теме [${topics.get(currentTopicId)}]:\n`;

            let logMsg;
            if (isTextOnly && msg.text) {
                logMsg = await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader + msg.text, { parse_mode: 'Markdown' });
            } else {
                try {
                    await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader, { parse_mode: 'Markdown' });
                    logMsg = await ctx.telegram.copyMessage(MY_TELEGRAM_ID, RP_CHAT_ID, msg.message_id);
                } catch (err) {
                    logMsg = await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader + `*Отправил медиафайл* 🔒`, { parse_mode: 'Markdown' });
                }
            }

            if (logMsg) {
                msgMapToLog.set(msg.message_id.toString(), logMsg.message_id.toString());
                msgMapToChat.set(logMsg.message_id.toString(), msg.message_id.toString());
                saveDataToDisk();
            }
        } catch (e) { console.error('Ошибка форварда:', e); }
    }
}

// ХЭНДЛЕРЫ ДЛЯ ГРУППЫ
bot.on('text', async (ctx) => {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        await logGroupMessageToUser(ctx, ctx.message, true);
    }
});

bot.on('message', async (ctx) => {
    const msg = ctx.message;
    if (!msg) return;

    // Если пишет юзер боту в личку
    if (ctx.chat.type === 'private' && msg.from.id === MY_TELEGRAM_ID) {
        if (!RP_CHAT_ID || activeTopicId === null) return ctx.reply('⚠️ Сначала напишите в группе.');

        let replyToMessageId = undefined;
        if (msg.reply_to_message) {
            const targetGroupId = msgMapToChat.get(msg.reply_to_message.message_id.toString());
            if (targetGroupId) replyToMessageId = Number(targetGroupId);
        }

        try {
            const sentMsg = await ctx.telegram.copyMessage(RP_CHAT_ID, MY_TELEGRAM_ID, msg.message_id, {
                message_thread_id: activeTopicId,
                reply_to_message_id: replyToMessageId
            });
            
            msgMapToChat.set(msg.message_id.toString(), sentMsg.message_id.toString());
            msgMapToLog.set(sentMsg.message_id.toString(), msg.message_id.toString());
            saveDataToDisk();
            await ctx.react('✅').catch(() => {});
        } catch (error) { console.error('Ошибка отправки:', error); }
        return;
    }

    // Если это группа (для медиафайлов, стикеров и гифок)
    if ((ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') && !msg.text) {
        await logGroupMessageToUser(ctx, msg, false);
    }
});

bot.launch().then(() => console.log('Эмилия полностью пересобрана и запущена!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
