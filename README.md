---
title: TeleClient + WPPConnect
emoji: 📱
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
---

# TeleClient (Telegram) + WPPConnect (WhatsApp)

Dos servicios independientes que corren en el mismo proceso Node.js:

- **Telegram**: monitorea un grupo, filtra mensajes por palabras clave y reenvía los coincidentes a webhooks de n8n.
- **WhatsApp**: funciona como un **bot de comandos** que responde a mensajes con `/comando`.

> Ambos servicios corren en el mismo container (Docker / HF Spaces). Son funcionalmente separados — Telegram no afecta a WhatsApp y viceversa.

## Entorno Variables

Configurar como secretos en Hugging Face Spaces:

### Telegram
- `API_ID`: Tu Telegram API ID
- `API_HASH`: Tu Telegram API Hash
- `TELEGRAM_SESSION`: Tu sesión de Telegram (formato teleproto)

### WhatsApp (WPPConnect)
- `WPP_SESSION_NAME`: Nombre de la sesión de WPPConnect (por defecto: `default`)

### Compartido
- `N8N_WEBHOOK_URL`: URL del webhook de n8n (solo usado por Telegram)

## Cómo funciona

### Telegram — Filtro de palabras clave + n8n
1. La app conecta a **Telegram** usando teleproto (gramjs fork)
2. Monitorea el grupo objetivo configurado (`TARGET_CHAT_ID`)
3. Filtra mensajes basándose en palabras clave (`bug`, `aprovechen`, `quemen`, `quemar`, `rebeca`, `5 soles`, `gratis`)
4. Envía los mensajes coincidentes al webhook de n8n

### WhatsApp — Bot de comandos
1. La app conecta a **WhatsApp Web** usando WPPConnect (Puppeteer)
2. Escucha mensajes en todos los chats
3. Cuando recibe un mensaje que empieza con `/`, busca el comando en el diccionario (`wppCommands` en `index.js`)
4. Si el comando existe, envía la respuesta correspondiente al mismo chat
5. Si el comando no existe, no hace nada

## Comandos de WhatsApp

| Comando | Respuesta |
|---|---|
| `/hola` | 🤖 Hola! |
| `/comandos` | Lista de comandos disponibles |

Para agregar nuevos comandos, edita el objeto `wppCommands` en `index.js`:

```javascript
const wppCommands = {
    'hola': '🤖 Hola!',
    'comandos': '🤖 Comandos disponibles:\n/hola - Saludo\n/comandos - Lista de comandos',
    'tu_comando': '🤖 Tu respuesta aquí',
};
```

## Endpoints

| Ruta | Descripción |
|---|---|
| `/` | Estado general de ambos servicios |
| `/telegram` | Estado del cliente de Telegram |
| `/wpp` | Estado del cliente de WhatsApp (Bot de Comandos) |

## Desarrollo local

```bash
npm install
cp .env.example .env
# Configura las variables en .env
npm run dev
```

## Despliegue en Hugging Face Spaces

Esta aplicación está configurada para ejecutarse como un **Docker Space** en Hugging Face Spaces con un solo container que ejecuta ambos servicios (Telegram + WhatsApp) simultáneamente.

> **Nota**: Hugging Face Spaces no soporta `docker-compose` multi-servicio. Ambos clientes corren en el mismo container, pero son funcionalmente independientes.

### Pasos:

1. Crear un nuevo Docker Space en HF
2. Subir este proyecto o conectar el repositorio
3. Configurar los secretos (API_ID, API_HASH, TELEGRAM_SESSION, N8N_WEBHOOK_URL)
4. El container iniciará automáticamente ambos clientes

Para WhatsApp, al iniciar se generará un QR que deberás escanear con tu teléfono para vincular la sesión.

## Estructura

```
.
├── index.js           # Punto de entrada principal (inicia ambos servicios)
├── package.json       # Dependencias (teleproto + wppconnect)
├── Dockerfile         # Imagen con Node + Chromium
├── .env.example       # Variables de entorno de ejemplo
└── README.md
```

## Palabras clave (Telegram)

Mensajes que contienen cualquiera de estas palabras son reenviadas a n8n:

| Servicio | Palabras clave |
|---|---|
| Telegram | bug, aprovechen, quemen, quemar, rebeca, 5 soles, gratis |
| WhatsApp | N/A — Solo responde a comandos con `/` |

## Limitaciones

- **Puppeteer/Chromium**: WPPConnect usa un navegador headless, lo que requiere más RAM que Telegram solo. Asegúrate de que tu HF Space tenga suficiente memoria.
- **Sesión WhatsApp**: La sesión de WhatsApp puede requerir re-escanear el QR periódicamente.
- **Un solo puerto**: Ambos servicios comparten el puerto 7860 con rutas diferenciadas.
