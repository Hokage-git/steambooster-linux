(function () {
  'use strict';
  sb.plugins.register({
    id: 'linux-test',
    version: '0.0.1',
    apiVersion: 1,
    displayName: 'Linux Test Plugin',
    description: 'Minimal plugin to verify the Linux launcher can inject into Steam.',
    contextKinds: ['main'],
    capabilities: ['ui'],
    init: function (ctx) {
      ctx.log.info('linux-test: init');
      var btn = ctx.sb.ui.addHeaderButton({
        id: 'linux-test-btn',
        label: 'Linux Test',
        onClick: function () {
          ctx.log.info('linux-test: button clicked');
        },
      });
      return function () {
        btn.remove();
        ctx.log.info('linux-test: cleanup');
      };
    },
  });
})();
