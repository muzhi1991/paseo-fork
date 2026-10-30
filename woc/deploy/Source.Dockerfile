ARG WOC_RUNTIME_BASE
FROM ${WOC_RUNTIME_BASE}
USER root
COPY packs /tmp/woc-paseo-packs
RUN npm install --prefix /opt/runtime --omit=dev /tmp/woc-paseo-packs/*.tgz && rm -rf /tmp/woc-paseo-packs
USER node
