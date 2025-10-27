# Use a small Node image
FROM node:18-alpine
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

# Use the PORT from the environment (Render provides one)
ENV PORT=10000
EXPOSE 10000

# Start app (ensure package.json has a start script)
CMD ["npm", "start"]