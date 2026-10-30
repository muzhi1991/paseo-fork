FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ tini procps && rm -rf /var/lib/apt/lists/*
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm install --prefix /opt/runtime --omit=dev @getpaseo/cli@0.14.0 @earendil-works/pi-coding-agent@1.4.0 ws@8.18.3
ENV PATH=/opt/runtime/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
RUN curl -fsSL https://cua.ai/install.sh -o /tmp/cua-install.sh && sh /tmp/cua-install.sh -y --cli-only --version 0.7.0 --prefix /usr/local --no-onboarding --no-modify-path && rm /tmp/cua-install.sh
RUN mkdir -p /opt/paseo-woc /opt/woc /state /workspace/woc && ln -s /opt/runtime/node_modules /opt/paseo-woc/node_modules && ln -s /opt/runtime/node_modules /opt/node_modules && chown -R node:node /state /workspace
WORKDIR /workspace/woc
USER node
ENV PASEO_HOME=/state/paseo PI_CODING_AGENT_DIR=/state/pi PASEO_LISTEN=127.0.0.1:6767 PASEO_WEB_UI_ENABLED=true PASEO_WEB_UI_DIST_DIR=/opt/web-ui
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/paseo-woc/woc/runtime/start.mjs"]
