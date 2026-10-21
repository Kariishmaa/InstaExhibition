FROM node:20-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
# Set ANTHROPIC_API_KEY as an environment variable on your host (never put it in this file).
EXPOSE 6320
CMD ["node", "server.js"]
