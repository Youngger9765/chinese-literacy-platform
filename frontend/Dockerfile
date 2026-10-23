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
ARG VITE_PARENT_PORTAL_ENABLED=false
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SHOW_DEMO_LOGIN=${VITE_SHOW_DEMO_LOGIN}
ENV VITE_DEMO_ADMIN_EMAIL=${VITE_DEMO_ADMIN_EMAIL}
ENV VITE_DEMO_ADMIN_PW=${VITE_DEMO_ADMIN_PW}
ENV VITE_DEMO_TEACHER_EMAIL=${VITE_DEMO_TEACHER_EMAIL}
ENV VITE_DEMO_TEACHER_PW=${VITE_DEMO_TEACHER_PW}
ENV VITE_DEMO_STUDENT_EMAIL=${VITE_DEMO_STUDENT_EMAIL}
ENV VITE_DEMO_STUDENT_PW=${VITE_DEMO_STUDENT_PW}
ENV VITE_PARENT_PORTAL_ENABLED=${VITE_PARENT_PORTAL_ENABLED}
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

# #3719 — IAP 準備：staging/preview 的部署腳本在 build 這個 image 之前就已經
# 知道自己這次 backend 的 Cloud Run 網址，傳進來就會同源轉送 /api、/assets、
# /q（跟 firebase.json 的 rewrite 同一組前綴）。不傳（production 走這裡，
# production 的 Firebase Hosting 路線本來就已經同源，見 firebase.json）就是
# 今天這樣，只有 SPA fallback —— 零改變。細節/取捨見 render-nginx-conf.sh。
ARG BACKEND_INTERNAL_URL=""
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
COPY docker/render-nginx-conf.sh /tmp/render-nginx-conf.sh
RUN sh /tmp/render-nginx-conf.sh && rm /tmp/render-nginx-conf.sh
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
