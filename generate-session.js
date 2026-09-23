require('dotenv').config();

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH;

if (!API_ID || !API_HASH) {
    console.error('❌ Faltan API_ID o API_HASH en el archivo .env');
    process.exit(1);
}

console.log('📱 Generando sesión de Telegram...');
console.log('📱 Este script te pedirá tu número de teléfono y código de verificación.');
console.log('📱 La sesión generada se mostrará al final.\n');

const session = new StringSession('');
const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
});

(async () => {
    try {
        await client.start({
            phoneNumber: async () => {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                return new Promise((resolve) => {
                    rl.question('📱 Ingresa tu número de teléfono (con código de país, ej: +51999999999): ', (answer) => {
                        rl.close();
                        resolve(answer);
                    });
                });
            },
            password: async () => {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                return new Promise((resolve) => {
                    rl.question('🔐 Ingresa tu contraseña de 2FA (si tienes): ', (answer) => {
                        rl.close();
                        resolve(answer);
                    });
                });
            },
            phoneCode: async () => {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                return new Promise((resolve) => {
                    rl.question('📲 Ingresa el código de verificación que recibiste: ', (answer) => {
                        rl.close();
                        resolve(answer);
                    });
                });
            },
            onError: (err) => {
                console.error('❌ Error:', err.message);
            },
        });

        console.log('\n✅ Sesión generada exitosamente!');
        console.log('📋 Copia esta string y añádela a tu archivo .env como TELEGRAM_SESSION:\n');
        console.log('='.repeat(80));
        console.log(session.save());
        console.log('='.repeat(80));
        console.log('\n📝 Añade esto a tu archivo .env:');
        console.log('TELEGRAM_SESSION=' + session.save());
        console.log('\n');

        await client.disconnect();
    } catch (error) {
        console.error('❌ Error generando sesión:', error.message);
        process.exit(1);
    }
})();
