import 'dotenv/config';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { NewMessage } from 'teleproto/events/index.js';
import axios from 'axios';

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

const PHONE_NUMBER = process.env.PHONE_NUMBER;
const SESSION_STRING = process.env.SESSION_STRING;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const GROUPS_IDS = process.env.GROUPS_IDS
    ? process.env.GROUPS_IDS.split(',').map(id => parseInt(id.trim()))
    : [];

const wordsToReact = process.env.WORDS_TO_REACT
    ? process.env.WORDS_TO_REACT.split(',').map(word => word.trim())
    : [];

const ignoredSenders = process.env.IGNORED_SENDERS
    ? process.env.IGNORED_SENDERS.split(',').map(name => name.trim().toLowerCase())
    : [];

async function startListener() {
    if (!API_ID || !API_HASH) {
        console.error('❌ Please set API_ID and API_HASH in your .env file');
        console.log('📝 Get your credentials from https://my.telegram.org');
        return;
    }

    if (!SESSION_STRING) {
        console.log('⚠️ No SESSION_STRING found in .env');
        console.log('🔑 Session will be generated after first login');
        console.log('💡 You can add it to .env to persist session');
    }

    console.log('🚀 Starting Telegram listener...');
    console.log(`📱 Target supergroup: ${GROUPS_IDS}`);

    const session = new StringSession(SESSION_STRING || '');
    const client = new TelegramClient(session, API_ID, API_HASH, {
        phone: PHONE_NUMBER
    });

    try {
        await client.start();

        // Get session string and display it for saving to .env
        const currentSessionString = client.session.save();
        if (currentSessionString && !SESSION_STRING) {
            console.log('🔑 Session string generated:');
            console.log('SESSION_STRING=' + currentSessionString);
            console.log('💡 Add this to your .env file to persist session');
        }

        console.log('✅ Successfully connected to Telegram');

        // Listen for new messages in the supergroup
        client.addEventHandler(async (event) => {
            const message = event.message;
            const messageText = message.message || '';

            // Obtenemos el remitente usando el método nativo del mensaje
            const sender = await message.getSender().catch(() => null);

            let senderName = 'Anonymous';

            if (sender) {
                // Concatenamos nombre y apellido si existen, o usamos el username
                const firstName = sender.firstName || '';
                const lastName = sender.lastName || '';
                senderName = (firstName + ' ' + lastName).trim() || sender.username || 'Usuario sin nombre';
            }

            //console.log(`📨 Nuevo mensaje de ${senderName}:`);
            //console.log(`   ${messageText}`);

            // Check if sender is ignored
            const senderLower = senderName.toLowerCase();
            const isIgnored = ignoredSenders.some(ignored => senderLower.includes(ignored));

            if (isIgnored) {
                //console.log(`🚫 Mensaje ignorado de: ${senderName}`);
                return;
            }

            // Check if message contains any word from the list
            const messageLower = messageText.toLowerCase();
            const foundWord = wordsToReact.find(word => messageLower.includes(word.toLowerCase()));

            if (foundWord) {
                //console.log(`🚀 Palabra detectada: "${foundWord}" - Enviando webhook...`);

                try {
                    const messageUrl = `https://t.me/c/${message.chatId.toString().replace('-100', '')}/${message.id}`;

                    const webhookData = {
                        sender: senderName,
                        message: messageText,
                        detected_word: foundWord,
                        timestamp: new Date().toISOString(),
                        chat_id: message.chatId,
                        message_url: messageUrl
                    };

                    if (WEBHOOK_URL) {
                        await axios.post(WEBHOOK_URL, webhookData, {
                            timeout: 5000,
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });
                        console.log('✅ Webhook enviado exitosamente');
                    } else {
                        console.log('⚠️ WEBHOOK_URL no configurado en .env');
                    }
                } catch (error) {
                    console.error('❌ Error al enviar webhook:', error.message);
                }
            }
        }, new NewMessage({ chats: GROUPS_IDS }));


        console.log('👂 Listening for messages...');
        console.log('Press Ctrl+C to stop');

        // Keep the script running
        process.on('SIGINT', async () => {
            console.log('\n🛑 Stopping listener...');
            await client.disconnect();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Failed to start client:', error.message);

        if (error.message.includes('PHONE_CODE_INVALID')) {
            console.log('💡 Please check your phone number and try again');
        } else if (error.message.includes('API_ID_INVALID')) {
            console.log('💡 Please check your API_ID and API_HASH');
        }
    }
}

startListener().catch(console.error);
