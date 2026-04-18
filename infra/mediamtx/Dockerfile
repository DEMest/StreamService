FROM bluenviron/mediamtx:latest AS mediamtx
FROM alpine:3.20
RUN apk add --no-cache curl ffmpeg
COPY --from=mediamtx /mediamtx /mediamtx
COPY on-ready.sh /on-ready.sh
COPY on-not-ready.sh /on-not-ready.sh
RUN chmod +x /on-ready.sh /on-not-ready.sh
ENTRYPOINT ["/mediamtx"]
