import {
  API,
  Categories,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";

import { PLATFORM_NAME, PLUGIN_NAME } from "./settings";
import { UnifiFirewallSwitch } from "./platformAccessory";
import { UnifiFirewallPlatformConfig, UnifiFirewallRuleConfig } from "./config";
import { Controller } from "unifi-client";

/**
 * UnifiFirewallPlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class UnifiFirewallPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory<{
    rule: UnifiFirewallRuleConfig;
  }>[] = [];

  private configValid: boolean;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & UnifiFirewallPlatformConfig,
    public readonly api: API
  ) {
    this.configValid = this.validateConfig();

    this.log.debug(`Finished initializing platform: ${this.config.name}`);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on("didFinishLaunching", () => {
      log.debug("Executed didFinishLaunching callback");
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  private validateConfig() {
    const { unifi } = this.config;
    const hasCredentials = Boolean(unifi.username && unifi.password);
    const hasApiKey = Boolean(unifi.apiKey);

    if (hasApiKey && hasCredentials) {
      this.log.error(
        "Both an API key and username/password are configured. Please choose only one UniFi authentication method."
      );
      return false;
    }

    if (!hasApiKey && !hasCredentials) {
      this.log.error(
        "No UniFi authentication details provided. Configure either an API key or a local username/password."
      );
      return false;
    }

    return true;
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(
    accessory: PlatformAccessory<{ rule: UnifiFirewallRuleConfig }>
  ) {
    this.log.info("Loading accessory from cache:", accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    if (!this.configValid) {
      this.log.error(
        "Skipping device discovery because UniFi authentication is not configured correctly."
      );
      return;
    }

    const controllerConfig = {
      ...this.config.unifi,
      username: this.config.unifi.username ?? "",
      password: this.config.unifi.password ?? "",
    };
    const controller = new Controller(controllerConfig);
    if (this.config.unifi.apiKey && !this.config.unifi.useLocalCredentials) {
      this.log.debug("Using UniFi API key authentication.");
      controller.auth.autoReLogin = false;
      controller.auth.unifiOs = true;
      (controller.auth as unknown as { token?: string }).token =
        this.config.unifi.apiKey;
    } else {
      this.log.debug("Using UniFi username/password authentication.");
      await controller.login();
    }
    const sites = await controller.getSites();
    const site = sites.find((site) => site.name === this.config.unifi.site);
    if (!site) {
      throw new Error(
        `Site defined in Unifi config <${this.config.unifi.site}> was not found on the controller (Check the Controller URL)`
      );
    }
    const fwRules = await site.firewall.getRules();

    const explicitRuleConfigs = new Map(
      (this.config.rules ?? []).map((rule) => [rule.id, rule])
    );

    const includeRuleIndexes =
      this.config.includeRuleIndexes && this.config.includeRuleIndexes.length
        ? this.config.includeRuleIndexes
        : this.config.rules?.map((rule) => rule.id) ?? [];

    const includeSet = new Set<string>(
      includeRuleIndexes.length
        ? includeRuleIndexes.map(String)
        : fwRules.map((rule) => `${rule.rule_index}`)
    );
    const excludeSet = new Set<string>(
      (this.config.excludeRuleIndexes ?? []).map(String)
    );
    const hiddenSet = new Set<string>(
      (this.config.hiddenRuleIndexes ?? []).map(String)
    );
    const customNames = this.config.customNames ?? {};

    const missingRuleIndexes = [...includeSet].filter(
      (ruleIndex) => !fwRules.find((rule) => `${rule.rule_index}` === ruleIndex)
    );
    if (missingRuleIndexes.length) {
      this.log.warn(
        `The following rule indexes were requested but not found on the controller: ${missingRuleIndexes.join(
          ", "
        )}`
      );
    }

    const hiddenRules = fwRules.filter((rule) => {
      const ruleIndex = `${rule.rule_index}`;
      return includeSet.has(ruleIndex) && hiddenSet.has(ruleIndex);
    });
    const excludedRules = fwRules.filter((rule) => {
      const ruleIndex = `${rule.rule_index}`;
      return includeSet.has(ruleIndex) && excludeSet.has(ruleIndex);
    });

    const discoverableRules = fwRules.filter((rule) => {
      const ruleIndex = `${rule.rule_index}`;
      if (!includeSet.has(ruleIndex)) {
        return false;
      }
      if (excludeSet.has(ruleIndex) || hiddenSet.has(ruleIndex)) {
        return false;
      }
      return true;
    });

    const discoverableRuleIndexes = new Set(
      discoverableRules.map((rule) => `${rule.rule_index}`)
    );
    const cachedAccessoriesToRemove = this.accessories.filter((accessory) => {
      const cachedRuleId = accessory.context.rule?.id;
      if (!cachedRuleId) {
        return false;
      }
      return !discoverableRuleIndexes.has(cachedRuleId);
    });

    if (cachedAccessoriesToRemove.length) {
      this.log.info(
        `Unregistering ${cachedAccessoriesToRemove.length} cached accessory(ies) for hidden or excluded rules.`
      );
      this.api.unregisterPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        cachedAccessoriesToRemove
      );
    }

    this.log.info(
      `Discovered ${
        discoverableRules.length
      } firewall rule(s) for Homebridge: ${
        discoverableRules.map((rule) => `${rule.rule_index}`).join(", ") ||
        "none"
      }`
    );
    if (hiddenRules.length) {
      this.log.info(
        `Hidden firewall rule(s): ${hiddenRules
          .map((rule) => `${rule.rule_index}`)
          .join(", ")}`
      );
    }
    if (excludedRules.length) {
      this.log.info(
        `Excluded firewall rule(s): ${excludedRules
          .map((rule) => `${rule.rule_index}`)
          .join(", ")}`
      );
    }

    for (const fwRule of discoverableRules) {
      const ruleIndex = `${fwRule.rule_index}`;
      const ruleConfig = explicitRuleConfigs.get(ruleIndex);
      const name =
        customNames[ruleIndex] ?? ruleConfig?.name ?? fwRule.name ?? ruleIndex;
      const inverted = ruleConfig?.inverted ?? false;

      const rule: UnifiFirewallRuleConfig = {
        id: ruleIndex,
        name,
        inverted,
      };

      const uuid = this.api.hap.uuid.generate(rule.id);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(
        (accessory) => accessory.UUID === uuid
      );

      if (existingAccessory) {
        // the accessory already exists
        this.log.info(
          `Restoring existing accessory from cache: ${existingAccessory.displayName}`
        );

        existingAccessory.context.rule = rule;
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new UnifiFirewallSwitch(this, existingAccessory, fwRule, rule.inverted);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info(`Adding new accessory: ${rule.name} <${rule.id}>`);

        // create a new accessory
        const accessory = new this.api.platformAccessory<{
          rule: UnifiFirewallRuleConfig;
        }>(rule.name, uuid, Categories.SWITCH);

        // store a copy of the rule object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.rule = rule;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new UnifiFirewallSwitch(this, accessory, fwRule, rule.inverted);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
      }
    }
  }
}
