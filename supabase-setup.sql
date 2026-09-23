-- Crear tabla para almacenar sesión de WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id TEXT PRIMARY KEY,
    session_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_updated_at ON whatsapp_sessions(updated_at);

-- Habilitar Row Level Security (opcional, pero recomendado)
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Política para permitir lectura/escritura (ajusta según tus necesidades de seguridad)
CREATE POLICY "Allow all operations on whatsapp_sessions" 
ON whatsapp_sessions FOR ALL 
USING (true) 
WITH CHECK (true);

-- Comentario sobre la tabla
COMMENT ON TABLE whatsapp_sessions IS 'Almacena las sesiones de WhatsApp para persistencia entre reinicios';
