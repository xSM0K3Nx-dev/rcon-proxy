FROM oven/bun:1

WORKDIR /app

COPY package.json ./
COPY server.js ./

EXPOSE 8080

CMD ["bun", "server.js"]
