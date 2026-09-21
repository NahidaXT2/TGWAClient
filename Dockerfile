# Usa una imagen base ligera de Node.js
FROM node:lts-alpine

# Instalar dependencias del sistema necesarias
RUN apk add --no-cache dumb-init

# Crear un usuario no root para mayor seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app && \
    chown -R nodejs:nodejs /app

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de configuración primero para aprovechar el caché de Docker
COPY --chown=nodejs:nodejs package.json package-lock.json tsconfig.json ./

# Instala las dependencias de Node.js
RUN npm ci && \
    npm cache clean --force

# Copia el código fuente
COPY --chown=nodejs:nodejs src ./src

# Compila TypeScript
RUN npm run build

# Copia los archivos compilados
RUN cp -r dist dist_copy && \
    rm -rf dist && \
    mv dist_copy dist

# Cambiar al usuario no root
USER nodejs

# Expone el puerto 7860 (puerto por defecto de Hugging Face Spaces)
EXPOSE 7860

# Usa dumb-init para manejar señales correctamente
ENTRYPOINT ["dumb-init", "--"]

# Comando para ejecutar la aplicación
CMD ["node", "dist/index.js"]