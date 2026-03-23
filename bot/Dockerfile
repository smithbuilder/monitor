FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY bot.js register-commands.js ./

CMD ["node", "bot.js"]
