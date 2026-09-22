---
title: TeleClient + WhatsApp Debug Logger
emoji: 📱
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
---

# TeleClient (Telegram) + WhatsApp (Baileys)

Dos servicios en un solo proceso Node.js:

- **Telegram**: monitorea un grupo, filtra mensajes por palabras clave y reenvía los coincidentes a webhooks de n8n.
- **WhatsApp**: loguea todos los mensajes de texto (remitente, grupo, timestamp, si es mío o no) para debug y obtención de IDs.

> Ambos servicios corren en el mismo container (Docker / HF Spaces). Son funcionalmente separados.

## Variables de Entorno

Configurar como secretos en Hugging Face Spaces:

### Telegram
- `API_ID`: Tu Telegram API ID
- `API_HASH`: Tu Telegram API Hash
- `TELEGRAM_SESSION`: Tu sesión de Telegram (formato teleproto)

### WhatsApp (Baileys)
- `WPP_SESSION_PATH`: Ruta del directorio de sesión (por defecto: `./wpp-session`)

### Compartido
- `N8N_WEBHOOK_URL`: URL del webhook de n8n (solo usado por Telegram)

### Supabase (Opcional)
- `SUPABASE_URL`: URL de tu proyecto Supabase (actualmente no utilizado, reservado para futuro)
- `SUPABASE_SERVICE_ROLE_KEY`: Service Role Key

## Cómo funciona

### Telegram — Filtro de palabras clave + n8n
1. Conecta a Telegram usando teleproto (gramjs fork)
2. Monitorea el grupo objetivo (`TARGET_CHAT_ID = -1001713742924`)
3. Filtra mensajes con palabras clave (`bug`, `aprovechen`, `quemen`, `quemar`, `rebeca`, `5 soles`, `gratis`)
4. Reenvía coincidentes al webhook de n8n

### WhatsApp — Logger de mensajes (Baileys)
1. Conecta a WhatsApp Web usando Baileys (WebSocket directo, sin navegador)
2. Al iniciar, usa la sesión guardada en `WPP_SESSION_PATH` (o `./wpp-session` por defecto)
3. Si no hay sesión guardada, muestra un código QR en la **consola** para escanear
4. Escucha **todos** los mensajes de texto entrantes
5. Loguea en consola para cada mensaje:
   - ID del mensaje
   - Remitente (nombre y número)
   - ID del grupo o chat personal
   - Si el mensaje es mío (lo escribí yo) o de otra persona
   - Texto del mensaje
   - Timestamp ISO
6. Guarda credenciales automáticamente para evitar re-escanear QR

## Output de Debug (Ejemplo)

```
==================================================
[WhatsApp] 📩 Mensaje recibido
==================================================
  🆔 Mensaje ID:  abc123def456
  👤 Remitente:    Juan Pérez
  📱 Número:       51987654321
  📁 Tipo chat:    grupo
  📛 ID del grupo: 12036301234567890@g.us
  🤖 ¿Es mío?:    No
  🏷️  Origen:      OTRA PERSONA
  📝 Texto:        Hola, qué tal
  ⏰ Timestamp:    2024-01-15T12:30:00.000Z
==================================================
```

## Instalación y Ejecución

```bash
npm install
cp .env.example .env
# Configura las variables en .env
npm start
```

Al iniciar, verás:
1. Telegram conectándose (si las credenciales son correctas)
2. WhatsApp generando un código QR en la consola (primera vez) o conectándose automáticamente (si hay sesión guardada)

### Escanear QR (Primera vez)
1. Abre WhatsApp en tu teléfono
2. Ve a **Menú → Dispositivos vinculados → Vincular un dispositivo**
3. Escanea el código QR que aparece en la consola

## Endpoints

| Ruta | Descripción |
|---|---|
| `/` | Estado general de ambos servicios |
| `/telegram` | Estado del cliente de Telegram |
| `/wpp` | Estado del cliente de WhatsApp |

## Estructura

```
.
├── index.js           # Punto de entrada (Telegram + WhatsApp Baileys)
├── package.json       # Dependencias (teleproto + baileys)
├── Dockerfile         # Imagen Node.js (ligera, sin Chromium)
├── .env.example       # Variables de entorno
├── README.md
└── wpp-session/       # Directorio de sesión WhatsApp (creado automáticamente)
    ├── credentials.json
    └── ...
```

## Palabras clave (Telegram)

Mensajes que contienen cualquiera de estas palabras son reenviadas a n8n:

| Servicio | Palabras clave |
|---|---|
| Telegram | bug, aprovechen, quemen, quemar, rebeca, 5 soles, gratis |
| WhatsApp | N/A — Solo loguea mensajes de texto para debug |

## Limitaciones

- **Sesión de WhatsApp**: La sesión se guarda localmente en `wpp-session/`. Si este directorio se borra, deberás re-escanear el QR. No se persiste en la nube (para simplicidad).
- **Un solo puerto**: Ambos servicios comparten el puerto 7860 con rutas diferenciadas.
- **WhatsApp Web**: Baileys usa la API no oficial de WhatsApp Web. Puede requerir actualizaciones si WhatsApp cambia su protocolo.
- **Reconexión automática**: WhatsApp se reconecta automáticamente si se pierde la conexión (excepto si la sesión fue cerrada intencionalmente con código 401).

## Despliegue en Hugging Face Spaces

Esta aplicación está configurada para ejecutarse como un **Docker Space** en Hugging Face Spaces con un solo container.

### Pasos:

1. Crear un nuevo Docker Space en HF
2. Subir este proyecto o conectar el repositorio
3. Configurar los secretos (API_ID, API_HASH, TELEGRAM_SESSION, N8N_WEBHOOK_URL)
4. El container iniciará automáticamente ambos clientes

Para WhatsApp, al iniciar se generará un QR en la consola (logs del container) para escanear con tu teléfono.
