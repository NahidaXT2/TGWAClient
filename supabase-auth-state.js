const { createClient } = require('@supabase/supabase-js');
const {
    initAuthCreds,
    BufferJSON,
    proto,
} = require('@whiskeysockets/baileys');

class SupabaseAuthState {
    constructor(supabaseUrl, supabaseKey, sessionId = 'default') {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.sessionId = sessionId;
        this.creds = null;
        // Mapa plano: { "tipo-id": value } con Buffers vivos
        this.keysData = {};
    }

    // ---------- Carga ----------
    async loadState() {
        try {
            console.log('📥 [Supabase] Cargando sesión de WhatsApp...');

            const { data, error } = await this.supabase
                .from('whatsapp_sessions')
                .select('session_data')
                .eq('id', this.sessionId)
                .maybeSingle(); // maybeSingle: no error si no existe

            if (error) throw error;

            if (!data || !data.session_data) {
                console.log('ℹ️ [Supabase] No se encontró sesión previa. Se creará una nueva.');
                this.creds = initAuthCreds(); // 🔑 CLAVE
                this.keysData = {};
                return;
            }

            const session = data.session_data;

            // Revivir Buffers con BufferJSON.reviver
            this.creds = session.creds
                ? JSON.parse(JSON.stringify(session.creds), BufferJSON.reviver)
                : initAuthCreds();

            this.keysData = session.keys
                ? JSON.parse(JSON.stringify(session.keys), BufferJSON.reviver)
                : {};

            console.log('✅ [Supabase] Sesión cargada exitosamente');
        } catch (error) {
            console.error('❌ [Supabase] Error cargando sesión:', error.message);
            // Fallback seguro: creds nuevos para no romper el handshake
            this.creds = initAuthCreds();
            this.keysData = {};
        }
    }

    // ---------- Guardado ----------
    async saveState() {
        try {
            // Convertir Buffers a formato JSON-safe
            const creds = JSON.parse(JSON.stringify(this.creds, BufferJSON.replacer));
            const keys = JSON.parse(JSON.stringify(this.keysData, BufferJSON.replacer));

            const { error } = await this.supabase
                .from('whatsapp_sessions')
                .upsert({
                    id: this.sessionId,
                    session_data: { creds, keys },
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'id' });

            if (error) throw error;
        } catch (error) {
            console.error('❌ [Supabase] Error guardando estado:', error.message);
        }
    }

    async clearState() {
        try {
            const { error } = await this.supabase
                .from('whatsapp_sessions')
                .delete()
                .eq('id', this.sessionId);
            if (error) throw error;

            this.creds = initAuthCreds();
            this.keysData = {};
            console.log('🗑️ [Supabase] Sesión eliminada');
        } catch (error) {
            console.error('❌ [Supabase] Error eliminando sesión:', error.message);
        }
    }

    // ---------- AuthState compatible con Baileys ----------
    async getAuthState() {
        await this.loadState();
        const self = this;

        const keys = {
            // Baileys: keys.get(type, ids) → { [id]: value }
            get: async (type, ids) => {
                const out = {};
                for (const id of ids) {
                    let value = self.keysData[`${type}-${id}`] ?? null;

                    // Normalización obligatoria para app-state-sync-key
                    if (type === 'app-state-sync-key' && value) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    out[id] = value;
                }
                return out;
            },

            // Baileys: keys.set({ [type]: { [id]: value } })
            set: async (data) => {
                for (const category of Object.keys(data)) {
                    for (const id of Object.keys(data[category])) {
                        const value = data[category][id];
                        const key = `${category}-${id}`;
                        if (value) self.keysData[key] = value;
                        else delete self.keysData[key];
                    }
                }
                await self.saveState();
            },
        };

        // saveCreds SIN parámetros: Baileys muta state.creds por referencia
        const saveCreds = async () => {
            await self.saveState();
        };

        return {
            state: { creds: self.creds, keys },
            saveCreds,
        };
    }
}

async function useSupabaseAuthState(supabaseUrl, supabaseKey, sessionId = 'default') {
    const auth = new SupabaseAuthState(supabaseUrl, supabaseKey, sessionId);
    return await auth.getAuthState();
}

module.exports = { SupabaseAuthState, useSupabaseAuthState };