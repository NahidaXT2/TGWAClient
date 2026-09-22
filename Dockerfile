FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

EXPOSE 7860

CMD ["node", "index.js"]
