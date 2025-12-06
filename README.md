# Homebridge UniFi Firewall

Expose UniFi firewall rules as HomeKit switches through Homebridge. The plugin logs in to your UniFi controller, reads firewall rules for the configured site, and creates a switch for each rule you choose to surface.

## Configuration

Add the platform to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "UnifiFirewall",
      "name": "UniFi Firewall",
      "unifi": {
        "url": "https://unifi.local:8443",
        "username": "homebridge",
        "password": "super-secret",
        "site": "default",
        "strictSSL": false
      },
      "includeRuleIndexes": ["2001", "2005", "3000"],
      "excludeRuleIndexes": ["2005"],
      "hiddenRuleIndexes": ["3000"],
      "customNames": {
        "2001": "WAN Drop"
      }
    }
  ]
}
```

### Discovery Controls

- **`includeRuleIndexes`**: Optional list of rule indexes to expose. When omitted, all firewall rules are eligible.
- **`excludeRuleIndexes`**: Rules that should not appear, even if included elsewhere.
- **`hiddenRuleIndexes`**: Rules that are discovered and reported in the log but are not registered as HomeKit accessories.
- **`customNames`**: Map of rule index to the HomeKit accessory name. Defaults to the controller rule name.

### Legacy Rule Configuration

The previous `rules` block is still supported for compatibility and can be used to specify names and inversion flags per rule:

```json
{
  "rules": [
    { "id": "2001", "name": "WAN Drop", "inverted": false },
    { "id": "2005", "name": "Block Guests", "inverted": true }
  ]
}
```

Any rules listed in `includeRuleIndexes` or `hiddenRuleIndexes` will still honour names and inversion settings from the `rules` entries when present.
