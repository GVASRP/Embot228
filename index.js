const { Telegraf } = require('telegraf');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === НАСТРОЙКИ ===
const BOT_TOKEN = '8696927422:AAGe2rDO5uDKY4Ac5B8_EDQvLYYL91ivNns'; 
const MY_TELEGRAM_ID = 6318051388; 

// Пути к файлам сохранения
const TOPICS_FILE = path.join(__dirname, 'topics_db.json');
const MSGMAP_FILE = path.join(__dirname, 'msgmap_db.json');

// Переменные состояния
let RP_CHAT_ID = null;
let activeTopicId = null;
let topics = new Map();
let msgMapToChat = new Map();
let msgMapToLog = new Map();

// === ФУНКЦИИ ДЛЯ РАБОТЫ С ДИСКОМ ===
const loadDataFromDisk = () => {
    try {
        if (fs.existsSync(TOPICS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
            RP_CHAT_ID = raw.RP_CHAT_ID || null;
            activeTopicId = raw.activeTopicId !== undefined ? raw.activeTopicId : null;
            topics = new Map(Object.entries(raw.topics || {}));
            console.log('📋 Темы успешно загружены с диска!');
        }
        if (fs.existsSync(MSGMAP_FILE)) {
            const raw = JSON.parse(fs.readFileSync(MSGMAP_FILE, 'utf8'));
            msgMapToChat = new Map(Object.entries(raw.toChat || {}));
            msgMapToLog = new Map(Object.entries(raw.toLog || {}));
            console.log('🔗 Связи сообщений успешно загружены с диска!');
        }
    } catch (e) {
        console.error('Ошибка чтения базы данных с диска:', e);
    }
};

const saveDataToDisk = () => {
    try {
        const topicsData = {
            RP_CHAT_ID,
            activeTopicId,
            topics: Object.fromEntries(topics)
        };
        const msgmapData = {
            toChat: Object.fromEntries(msgMapToChat),
            toLog: Object.fromEntries(msgMapToLog)
        };
        fs.writeFileSync(TOPICS_FILE, JSON.stringify(topicsData, null, 2), 'utf8');
        fs.writeFileSync(MSGMAP_FILE, JSON.stringify(msgmapData, null, 2), 'utf8');
    } catch (e) {
        console.error('Ошибка записи базы данных на диск:', e);
    }
};

// Загружаем данные сразу при старте скрипта
loadDataFromDisk();

// ЗАГЛУШКА ДЛЯ RENDER
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Emilia RP Bot is running stable!\n');
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

bot.on('callback_query', async (ctx) => {
    if (ctx.from.id !== MY_TELEGRAM_ID) return ctx.answerCbQuery('Доступ закрыт.');
    
    const data = ctx.callbackQuery.data;
    if (data.startsWith('select_topic:')) {
        const topicId = data.split(':')[1];
        activeTopicId = topicId === '0' ? 0 : Number(topicId);
        
        saveDataToDisk();
        
        await ctx.answerCbQuery(`Выбрана тема: ${topics.get(activeTopicId)}`);
        await ctx.editMessageText(`Вы переключились на тему: **${topics.get(activeTopicId)}**\nВсе сообщения и медиа отправляются туда.`, {
            parse_mode: 'Markdown',
            reply_markup: getTopicsKeyboard()
        });
    }
});

bot.command('menu', async (ctx) => {
    if (ctx.from.id !== MY_TELEGRAM_ID) return;
    if (!RP_CHAT_ID) return ctx.reply('⚠️ Бот еще не привязан к группе. Напишите что-нибудь в РП-темах группы.');
    
    await ctx.reply('Выберите активную тему для отправки сообщений от имени Эмилии:', {
        reply_markup: getTopicsKeyboard()
    });
});

bot.on(['message', 'edited_message'], async (ctx) => {
    const msg = ctx.message || ctx.editedMessage;
    if (!msg) return;

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const isPrivate = ctx.chat.type === 'private';

    if (isGroup) {
        RP_CHAT_ID = ctx.chat.id;
        const currentTopicId = msg.message_thread_id || 0;
        let needSave = false;
        
        if (msg.reply_to_message && msg.reply_to_message.forum_topic_created) {
            topics.set(currentTopicId, msg.reply_to_message.forum_topic_created.name);
            needSave = true;
        } else if (!topics.has(currentTopicId)) {
            topics.set(currentTopicId, `Тема #${currentTopicId || 'Главная'}`);
            needSave = true;
        }

        if (!activeTopicId && activeTopicId !== 0) {
            activeTopicId = currentTopicId;
            needSave = true;
        }

        if (needSave) saveDataToDisk();

        if (msg.from.id !== MY_TELEGRAM_ID && currentTopicId === activeTopicId) {
            try {
                const senderName = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
                const forwardHeader = `💬 **${senderName}** в теме [${topics.get(currentTopicId)}]:\n`;

                let logMsg;
                if (msg.text) {
                    logMsg = await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader + msg.text, { parse_mode: 'Markdown' });
                } else {
                    await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader, { parse_mode: 'Markdown' });
                    logMsg = await ctx.telegram.copyMessage(MY_TELEGRAM_ID, RP_CHAT_ID, msg.message_id);
                }

                msgMapToLog.set(msg.message_id.toString(), logMsg.message_id.toString());
                msgMapToChat.set(logMsg.message_id.toString(), msg.message_id.toString());
                saveDataToDisk();
            } catch (e) {
                console.error('Ошибка логирования в личку:', e);
            }
        }
        return;
    }

    if (isPrivate && msg.from.id === MY_TELEGRAM_ID) {
        if (!RP_CHAT_ID || activeTopicId === null) {
            return ctx.reply('⚠️ Напишите сначала любое сообщение в нужной теме внутри группы, чтобы бот её увидел.');
        }

        let replyToMessageId = undefined;
        if (msg.reply_to_message) {
            const targetGroupId = msgMapToChat.get(msg.reply_to_message.message_id.toString());
            // ВОТ ТУТ ФИКС: принудительно переводим ID из строки обратно в число!
            if (targetGroupId) replyToMessageId = Number(targetGroupId);
        }

        try {
            const extraOptions = {
                message_thread_id: activeTopicId,
                reply_to_message_id: replyToMessageId
            };

            const sentMsg = await ctx.telegram.copyMessage(RP_CHAT_ID, MY_TELEGRAM_ID, msg.message_id, extraOptions);
            
            msgMapToChat.set(msg.message_id.toString(), sentMsg.message_id.toString());
            msgMapToLog.set(sentMsg.message_id.toString(), msg.message_id.toString());
            saveDataToDisk();

            await ctx.react('✅').catch(() => {});
        } catch (error) {
            console.error('Ошибка отправки в группу:', error);
            await ctx.reply('❌ Не удалось отправить. Убедитесь, что бот добавлен в группу как админ со всеми правами.');
        }
    }
});

bot.launch().then(() => console.log('Эмилия защищена локальной БД и запущена!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
