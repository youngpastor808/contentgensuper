import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer('swangle');

Config.overrideWebpackConfig((currentConfiguration) => {
  return {
    ...currentConfiguration,
    resolve: {
      ...currentConfiguration.resolve,
      alias: {
        ...(currentConfiguration.resolve?.alias || {}),
        '@google/genai': false,
        'firebase': false,
        'firebase-admin': false,
        '@google-cloud/storage': false,
        '@google-cloud/vertexai': false,
      },
      fallback: {
        ...(currentConfiguration.resolve?.fallback || {}),
        fs: false,
        path: false,
        os: false,
        crypto: false,
      },
    },
  };
});


