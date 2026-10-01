# Notas de Refactorizacion

## Cambios Realizados

### Estructura de Archivos
El código ha sido reorganizado en módulos bajo el directorio `src/`:

```
src/
├── config/index.js          # Configuración centralizada
├── utils/
│   ├── logger.js            # Loggers (cacheLogger, socketLogger)
│   ├── cache.js             # createSafeCache
│   └── privacy.js           # maskJid
├── telegram/
│   ├── client.js            # Cliente Telegram y event handlers
│   └── processor.js         # processTelegramMessage
├── whatsapp/
│   ├── client.js            # Cliente Baileys y conexión
│   ├── commands.js          # Comandos (/now, /ping, /echo, /help)
│   ├── captcha.js           # Lógica de CAPTCHA
│   └── processor.js         # Procesamiento de mensajes → n8n
├── routes/
│   ├── index.js             # Rutas generales
│   ├── telegram.js          # Rutas de Telegram
│   └── whatsapp.js          # Rutas de WhatsApp
└── state/
    └── index.js             # Estado global compartido
```

### Cambios en WhatsApp

#### 1. Escuchar Mensajes Directos
- **Eliminado**: Filtro `if (!fromMe) continue;` - el bot ahora escucha mensajes de otros usuarios
- **Eliminado**: Anti-loop `sentMessageIds` - ya no es necesario
- **Agregado**: Variable de entorno `WPP_ALLOWED_CHATS` para especificar qué chats puede responder
- **Filtrado**: Solo responde a chats directos (ignora grupos que terminan en `@g.us`)
- **Seguridad**: Si `WPP_ALLOWED_CHATS` no está configurado, el bot no responde a ningún mensaje

#### 2. CAPTCHA
- **Cambio**: El CAPTCHA ahora se envía a la primera cuenta de `WPP_ALLOWED_CHATS[0]`
- **Seguridad**: Solo cuentas autorizadas pueden responder al CAPTCHA
- **Eliminado**: Dependencia de `TARGET_WPP_GROUP` para CAPTCHA

### Archivos Modificados
- `index.js` - Reducido de ~882 lineas a ~72 lineas (orquestador principal)
- `.env.example` - **NO SE PUDO MODIFICAR** (esta en .gitignore)

### Archivos Nuevos
- Todos los módulos en `src/`
- `REFACTOR_NOTES.md` (este archivo)

### Archivos Sin Cambios
- `package.json`
- `supabase-auth-state.js`
- `generate-session.js`

## Configuración Requerida

### Nueva Variable de Entorno Obligatoria
```env
WPP_ALLOWED_CHATS=1234567890@s.whatsapp.net,9876543210@s.whatsapp.net
```

**IMPORTANTE**: Debes agregar esta variable a tu archivo `.env`. Si no está configurada, el bot de WhatsApp no responderá a ningún mensaje.

### Variables de Entorno (completar en .env)
```env
# Telegram
API_ID=tu_api_id
API_HASH=tu_api_hash
TELEGRAM_SESSION=tu_session_string
TG_TARGET_GROUP=tu_grupo_id
N8N_WEBHOOK_URL=tu_webhook_url
WORDS_TO_REACT=palabra1,palabra2,palabra3

# WhatsApp
WPP_SESSION_PATH=./wpp-session
WPP_SESSION_ID=default
WPP_ALLOWED_CHATS=1234567890@s.whatsapp.net,9876543210@s.whatsapp.net
WPP_CAPTCHA_TIMEOUT=30000

# Supabase (opcional)
SUPABASE_URL=tu_supabase_url
SUPABASE_SERVICE_ROLE_KEY=tu_supabase_key

# Servidor
PORT=7860
```

### Variable Eliminada
- `WS_TARGET_GROUP` - Ya no se usa (reemplazado por `WPP_ALLOWED_CHATS`)

## Verificación

Para verificar que todo funciona correctamente:

1. **Verificar sintaxis**:
   ```bash
   node -c index.js
   ```

2. **Iniciar el servidor**:
   ```bash
   npm start
   ```

3. **Verificar endpoints**:
   - `GET /` - Estado general
   - `GET /telegram` - Estado de Telegram
   - `GET /wpp` - Estado de WhatsApp
   - `GET /wpp/qr` - QR de WhatsApp
   - `GET /wpp/commands` - Comandos disponibles

## Comportamiento Esperado

### WhatsApp
- Solo responde a mensajes de chats en `WPP_ALLOWED_CHATS`
- Ignora mensajes de grupos
- No responde a sus propios mensajes (sin anti-loop)
- CAPTCHA se envía a la primera cuenta autorizada
- Solo cuentas autorizadas pueden responder al CAPTCHA

### Telegram
- Sin cambios significativos
- Sigue escuchando el grupo configurado en `TG_TARGET_GROUP`
