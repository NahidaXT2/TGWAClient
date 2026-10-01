// ============================================================
// Estado global
// ============================================================
const state = {
    telegramConnected: false,
    shuttingDown: false,
};

function setTelegramConnected(value) {
    state.telegramConnected = value;
}

function isTelegramConnected() {
    return state.telegramConnected;
}

function setShuttingDown(value) {
    state.shuttingDown = value;
}

function isShuttingDown() {
    return state.shuttingDown;
}

// Exponer al scope global para acceso desde módulos
global.telegramConnected = state.telegramConnected;
global.shuttingDown = state.shuttingDown;

module.exports = {
    state,
    setTelegramConnected,
    isTelegramConnected,
    setShuttingDown,
    isShuttingDown,
};
