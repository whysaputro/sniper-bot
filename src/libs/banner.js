const colors = require('colors/safe');
const { version } = require('../../package.json');

module.exports = {
  banner: {
    show() {
      console.log(
        `${colors.blue(
          `
     ██████╗██╗   ██╗██████╗ ███████╗██████╗        ██████╗ ███╗   ██╗██╗
    ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗      ██╔═══██╗████╗  ██║██║
    ██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝█████╗██║   ██║██╔██╗ ██║██║
    ██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗╚════╝██║   ██║██║╚██╗██║██║
    ╚██████╗   ██║   ██████╔╝███████╗██║  ██║      ╚██████╔╝██║ ╚████║██║
     ╚═════╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝       ╚═════╝ ╚═╝  ╚═══╝╚═╝`,
        )} v${version}\n`,
      );
    },
  },
};
