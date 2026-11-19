# NAMI

NAMI documents the topology and addressing of planned industrial networks.

## Language

**Plan**  
The installation an engineer documents together. A plan can cover a standalone machine or a line spanning multiple machines, cabinets and networks.

**Network**  
A named group of interfaces within which planned IP addresses are checked for duplicates. Isolated networks have distinct identities even when their subnets match.

**Component**  
A physical device or virtual machine in a plan. A component can have multiple interfaces.

**Interface**  
A physical or virtual connection point on a component, such as a switch port or a VM’s virtual network adapter. Its network membership and IP addressing can be recorded independently of its cabling.

**Network membership**  
The assignment of an interface to a named network in the plan.

**Allocation pool**  
The range of IPv4 addresses in a network’s subnet considered for assignment. Existing assignments, reservations and excluded ranges are skipped when choosing the next address.

**Protocol profile**  
A set of optional planning fields for a protocol used on an interface. Several profiles can share an interface’s IP address and network assignment.

**Link**  
A documented connection with two ends. Each end identifies a component and can identify a specific interface when known.

**Hosted on**  
The relationship between a VM and the server that hosts it. The VM retains its own identity and interfaces when it changes hosts.
