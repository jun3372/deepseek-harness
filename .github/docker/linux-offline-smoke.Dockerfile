FROM almalinux:8

# The dependency set an unsigned Desktop RPM declares; preinstalled here so the offline
# installation step (dnf --disablerepo="*") resolves without any repository access.
RUN dnf install -y gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libuuid shadow-utils \
  && dnf clean all
