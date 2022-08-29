#!/bin/bash

# Note: This script has only been tested on Raspberry Pi OS, but should work on Debian and Ubuntu as well
# The script should be run with root permissions (e.g. using sudo).

BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo '##################################'
echo 'casync-updater installation script'
echo '##################################'
echo -e "${NC}"

# Install dependencies
echo -e "${BLUE}"
echo 'Installing dependencies'
echo -e "${NC}"
apt-get -y install nodejs
apt-get -y install casync
apt-get -y install diffutils

# Create directory for nodejs scripts
echo -e "${BLUE}"
echo 'Creating directory for nodejs scripts: /opt/casync-updater'
echo -e "${NC}"
mkdir -p /opt/casync-updater

# Create directory for configuration files
echo -e "${BLUE}"
echo 'Creating directory for configuration files: /etc/casync-updater'
echo -e "${NC}"
mkdir -p /etc/casync-updater

# Download default configuration file
echo -e "${BLUE}"
echo 'Downloading default configuration file: /etc/casync-updater/client.json'
echo -e "${NC}"
wget -O /etc/casync-updater/client.json https://github.com/bcc-code/casync-updater/raw/master/deploy/client.json

# Download casync-updater files using casync
echo -e "${BLUE}"
echo ''
echo 'Installing casync-updater script files'
echo ''
echo -e "${NC}"
casync extract --with=2sec-time --store=https://bcc-code.github.io/casync-updater/store.castr https://bcc-code.github.io/casync-updater/index.caidx /opt/casync-updater/

# Create service configuration file
echo -e "${BLUE}"
echo 'Configuring casync-updater systemd service'
echo -e "${NC}"
echo '[Unit]
Description=casync updater service
After=network.target

[Service]
WorkingDirectory=/opt/casync-updater/
ExecStart=nodejs /opt/casync-updater/client.js /etc/casync-updater
Restart=always

[Install]
WantedBy=multi-user.target' > /lib/systemd/system/casync-updater.service

systemctl daemon-reload
systemctl enable casync-updater
systemctl restart casync-updater

# Installation complete
echo -e "${BLUE}"
echo 'Installation complete!'
echo '######################'
echo ''
echo 'Please run "systemctl status casync-updater.service" to ensure the service is running correctly.'
echo 'Configuration files directory: /etc/casync-updater'
echo 'Add your own casync configuration files to /etc/casync-updater (see https://github.com/bcc-code/casync-updater for detailed instructions).'
echo 'Restart the casync-updater service after modifying configuration files for the changes to take effect.'
echo -e "${NC}"
