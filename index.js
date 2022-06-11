const { Plugin } = require('powercord/entities');
const { get } = require('powercord/http');
const { clipboard } = require('electron');
const undici = require('undici');
const Settings = require('./Settings.jsx');

const microPost = async (url, body, authKey) => {
  const req = await undici.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: authKey
    },
    body
  });
  return req.body.json();
};

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const ENCRYPTION_LENGTH = 256;

function arrayBufferToBase64 (buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

async function encryptContent (content) {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.generateKey(
    {
      name: ENCRYPTION_ALGORITHM,
      length: ENCRYPTION_LENGTH
    },
    true,
    [ 'encrypt', 'decrypt' ]
  );

  const encryptedContent = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv
    },
    key,
    new TextEncoder().encode(content)
  );

  const ivString = arrayBufferToBase64(iv);
  const encryptedString = arrayBufferToBase64(encryptedContent);
  const withIV = `${ivString}:${encryptedString}`;

  return {
    key: arrayBufferToBase64(await crypto.subtle.exportKey('raw', key)),
    encryptedContent: withIV
  };
}

/**
 * 
 * @param {[string]} args 
 * @param {any} setings
 * @returns {boolean | string}
 */
function getClipboard(args, settings) {
  if (!!args.includes('--clipboard')) {
    return clipboard.readText()
  } else if (settings.get('clip', true)) {
    return clipboard.readText()
  } else {
    return false
  }
}


/**
 * 
 * @param {[string]} args 
 * @returns {string}
 */
function getPassedText(args) {
  args.slice(args.indexOf('--text'))
  args.shift()
  return args.join(" ")
}

module.exports = class MicroPaste extends Plugin {
  startPlugin () {
    const HOST_OPTIONS = new Settings().HOST_OPTIONS;
    powercord.api.settings.registerSettings('micro-paste', {
      category: this.entityID,
      label: 'Micro Paste',
      render: Settings
    });

    powercord.api.commands.registerCommand({
      command: 'paste',
      description: 'Lets you paste content to Micro',
      usage: '{c} [--send] <--clipboard | FILE_URL> <--encrypt> <--burn> <--paranoid> <--extension MD/whateveridk>',
      executor: async (args) => {
        const domain = this.settings.get('domain', 'https://micro.sylo.digital');
        const authHeaderName = this.settings.get('authHeaderName', 'Authorization');
        const authKey = this.settings.get('authKey', '');

        let pickedDomain = "micro.sylo.digital"
        HOST_OPTIONS.forEach(obj => {
          obj.enabled = this.settings.get(`allowHost_${obj.set}}`, false);
          if (obj.enabled) pickedDomain = obj.label
        });
        

        /**
         * @type {boolean}
         */
        const send = args.includes('--send')
          ? !!args.splice(args.indexOf('--send'), 1)
          : this.settings.get('send', false);

        /**
         * @type {boolean | string}
         */
        const clipText = getClipboard(args, this.settings)

        const extension = args.includes('--extension')
          ? args[args.indexOf('--extension') + 1]
          : 'md';

        const encrypt = !!args.includes('--encrypt');

        const paranoid = !!args.includes('--paranoid');

        const burn = !!args.includes('--burn');

        if (!text) {
          return {
            send: false,
            result: `Invalid arguments. Run \`${powercord.api.commands.prefix}help paste\` for more information.`
          };
        }

        const body = {
          burn,
          content: text,
          encrypted: false,
          expiresAt: Date.now() + 86400000,
          extension,
          paranoid
        };

        let encryptionKey = false;

        if (encrypt) {
          const result = await encryptContent(text);
          body.encrypted = true;
          body.content = result.encryptedContent;
          encryptionKey = result.key;
        }

        const pasteBody = JSON.stringify(body);

        try {
          const body = await microPost(`${domain}/api/paste`, pasteBody, authHeaderName , authKey);
          if (body.statusCode >= 500) {
            return {
              send: false,
              result: `A server-side error occured: \`${body.message}\``
            }
          } else if (body.statusCode >= 400) {
            return {
              send: false,
              result: `Something went wrong on your end, check the auth key maybe? Message: \`${body.message}\``
            }
          }
          return {
            send,
            result: encryptionKey === false ? `https://${pickedDomain}/p/${body.id}` : `https:/${pickedDomain}/p/${body.id}#key=${encryptionKey}`
          };
        } catch (e) {
          return {
            send: false,
            result: `Upload to the specified domain ${domain} failed. Please check that the server is setup properly.`
          };
        }
      }
    });

    try {
      powercord.pluginManager.disable('pc-hastebin');
      this.shouldReenablePCHB = true
    } catch {
      this.shouldReenablePCHB = false
    }
  }

  pluginWillUnload () {
    powercord.api.settings.unregisterSettings('micro-paste');
    powercord.api.commands.unregisterCommand('paste');
    if (this.shouldReenablePCHB) powercord.pluginManager.enable('pc-hastebin')
    this.forceUpdate()
  }

  parseArguments (args) {
    const input = args.join(' ');
    if (input.startsWith('https://cdn.discordapp.com/attachments')) {
      return get(input).then(res => res.raw);
    }

    return false;
  }
};
