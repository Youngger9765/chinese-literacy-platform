# Stage 1: Build
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_API_URL=https://lingoleap-backend-958347263320.asia-east1.run.app
ARG VITE_SHOW_DEMO_LOGIN=false
ARG VITE_DEMO_ADMIN_EMAIL=""
ARG VITE_DEMO_ADMIN_PW=""
ARG VITE_DEMO_TEACHER_EMAIL=""
ARG VITE_DEMO_TEACHER_PW=""
ARG VITE_DEMO_STUDENT_EMAIL=""
ARG VITE_DEMO_STUDENT_PW=""
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SHOW_DEMO_LOGIN=${VITE_SHOW_DEMO_LOGIN}
ENV VITE_DEMO_ADMIN_EMAIL=${VITE_DEMO_ADMIN_EMAIL}
ENV VITE_DEMO_ADMIN_PW=${VITE_DEMO_ADMIN_PW}
ENV VITE_DEMO_TEACHER_EMAIL=${VITE_DEMO_TEACHER_EMAIL}
ENV VITE_DEMO_TEACHER_PW=${VITE_DEMO_TEACHER_PW}
ENV VITE_DEMO_STUDENT_EMAIL=${VITE_DEMO_STUDENT_EMAIL}
ENV VITE_DEMO_STUDENT_PW=${VITE_DEMO_STUDENT_PW}
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback: all routes → index.html
# absolute_redirect off: dir 尾斜線 301（如 /presentation → /presentation/）改送相對 Location，
# 否則 nginx 用內部 listen 8080 + http 拼絕對 URL → http://host:8080/... 對外連不到（Cloud Run 只開 443）
RUN echo 'server { listen 8080; absolute_redirect off; location / { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
