import * as vscode from 'vscode';
import * as net from 'net';
import * as cp from 'child_process';
import { ServerOptions, Executable, StreamInfo } from 'vscode-languageclient';

import { ConnectionHandler } from '../handler';
import { ConnectionType, ProtocolType, IConnectionConfiguration, PuppetInstallType } from '../interfaces';
import { ISettings } from '../settings';
import { PuppetStatusBar } from '../PuppetStatusBar';
import { OutputChannelLogger } from '../logging/outputchannel';
import { CommandEnvironmentHelper } from '../helpers/commandHelper';

export class TcpConnectionHandler extends ConnectionHandler {
  constructor(
    context: vscode.ExtensionContext,
    settings: ISettings,
    statusBar: PuppetStatusBar,
    logger: OutputChannelLogger,
    config: IConnectionConfiguration,
  ) {
    super(context, settings, statusBar, logger, config);
    this.logger.debug(`Configuring ${ConnectionType[this.connectionType]}::${this.protocolType} connection handler`);

    if (this.connectionType === ConnectionType.Local) {
      let exe: Executable = CommandEnvironmentHelper.getLanguageServerRubyEnvFromConfiguration(
        this.context.asAbsolutePath(this.config.languageServerPath),
        this.settings,
        this.config,
      );

      let logPrefix: string = '';
      switch (this.settings.installType) {
        case PuppetInstallType.PDK:
          logPrefix = '[getRubyEnvFromPDK] ';
          break;
        case PuppetInstallType.PUPPET:
          logPrefix = '[getRubyExecFromPuppetAgent] ';
          break;
      }

      this.logger.debug(logPrefix + 'Using environment variable RUBY_DIR=' + exe.options.env.RUBY_DIR);
      this.logger.debug(logPrefix + 'Using environment variable PATH=' + exe.options.env.PATH);
      this.logger.debug(logPrefix + 'Using environment variable RUBYLIB=' + exe.options.env.RUBYLIB);
      this.logger.debug(logPrefix + 'Using environment variable RUBYOPT=' + exe.options.env.RUBYOPT);
      this.logger.debug(logPrefix + 'Using environment variable SSL_CERT_FILE=' + exe.options.env.SSL_CERT_FILE);
      this.logger.debug(logPrefix + 'Using environment variable SSL_CERT_DIR=' + exe.options.env.SSL_CERT_DIR);
      this.logger.debug(logPrefix + 'Using environment variable GEM_PATH=' + exe.options.env.GEM_PATH);
      this.logger.debug(logPrefix + 'Using environment variable GEM_HOME=' + exe.options.env.GEM_HOME);

      let spawn_options: cp.SpawnOptions = {};
      let convertedOptions = Object.assign(spawn_options, exe.options);

      this.logger.debug(logPrefix + 'Editor Services will invoke with: ' + exe.command + ' ' + exe.args.join(' '));
      var proc = cp.spawn(exe.command, exe.args, convertedOptions);
      proc.stdout.on('data', data => {
        if (/LANGUAGE SERVER RUNNING/.test(data.toString())) {
          var p = data.toString().match(/LANGUAGE SERVER RUNNING.*:(\d+)/);
          settings.editorService.tcp.port = Number(p[1]);
          this.start();
        }
      });
      proc.on('close', exitCode => {
        this.logger.debug('SERVER terminated with exit code: ' + exitCode);
      });
      if (!proc || !proc.pid) {
        throw new Error(`Launching server using command ${exe.command} failed.`);
      }
    } else {
      this.start();
    }
  }

  get connectionType(): ConnectionType {
    switch (this.settings.editorService.protocol) {
      case ProtocolType.TCP:
        if (
          this.settings.editorService.tcp.address === '127.0.0.1' ||
          this.settings.editorService.tcp.address === 'localhost' ||
          this.settings.editorService.tcp.address === ''
        ) {
          return ConnectionType.Local;
        } else {
          return ConnectionType.Remote;
        }
      default:
        // In this case we have no idea what the type is
        return undefined;
    }
  }

  createServerOptions(): ServerOptions {
    this.logger.debug(
      `Starting language server client (host ${this.settings.editorService.tcp.address} port ${
        this.settings.editorService.tcp.port
      })`,
    );

    let serverOptions = () => {
      let socket = new net.Socket();

      socket.connect({
        port: this.settings.editorService.tcp.port,
        host: this.settings.editorService.tcp.address,
      });

      let result: StreamInfo = {
        writer: socket,
        reader: socket,
      };

      return Promise.resolve(result);
    };
    return serverOptions;
  }

  cleanup(): void {
    this.logger.debug(`No cleanup needed for ${this.protocolType}`);
  }
}
