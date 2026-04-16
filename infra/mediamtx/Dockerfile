FROM bluenviron/mediamtx:latest AS mediamtx
FROM alpine:3.20
RUN apk add --no-cache curl
COPY --from=mediamtx /mediamtx /mediamtx
ENTRYPOINT ["/mediamtx"]
