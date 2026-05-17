pragma solidity ^0.8.0;

contract DocumentRegistry {
    struct DocumentInfo {
        address issuer;
        string metadata;
        uint256 timestamp;
        bool isActive;
    }

    mapping(bytes32 => DocumentInfo) public documents;
    mapping(address => bool) public isIssuer;
    address public owner;

    event DocumentRegistered(
        bytes32 indexed docHash,
        address indexed issuer,
        string metadata,
        uint256 timestamp
    );

    event DocumentRevoked(
        bytes32 indexed docHash,
        address indexed issuer,
        uint256 timestamp
    );

    event IssuerAdded(address indexed issuer);
    
    event IssuerRemoved(address indexed issuer);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner can call this");
        _;
    }

    modifier onlyIssuer() {
        require(isIssuer[msg.sender], "Caller is not an issuer");
        _;
    }

    constructor(address[] memory _initialIssuers) {
        owner = msg.sender;
        for (uint i = 0; i < _initialIssuers.length; i++) {
            isIssuer[_initialIssuers[i]] = true;
            emit IssuerAdded(_initialIssuers[i]);
        }
    }

    function addIssuer(address _issuer) external onlyOwner {
        require(_issuer != address(0), "Invalid address");
        require(!isIssuer[_issuer], "Already an issuer");
        isIssuer[_issuer] = true;
        emit IssuerAdded(_issuer);
    }

    function removeIssuer(address _issuer) external onlyOwner {
        require(isIssuer[_issuer], "Not an issuer");
        isIssuer[_issuer] = false;
        emit IssuerRemoved(_issuer);
    }

    function registerDocument(bytes32 _docHash, string calldata _metadata) external onlyIssuer {
        require(_docHash != bytes32(0), "Hash cannot be empty");
        require(documents[_docHash].timestamp == 0, "Document already registered");

        documents[_docHash] = DocumentInfo({
            issuer: msg.sender,
            metadata: _metadata,
            timestamp: block.timestamp,
            isActive: true
        });

        emit DocumentRegistered(_docHash, msg.sender, _metadata, block.timestamp);
    }

    function revokeDocument(bytes32 _docHash) external onlyIssuer {
        DocumentInfo storage doc = documents[_docHash];
        require(doc.timestamp != 0, "Document does not exist");
        require(doc.issuer == msg.sender, "Only the issuer can revoke this document");
        require(doc.isActive, "Document already revoked");

        doc.isActive = false;
        emit DocumentRevoked(_docHash, msg.sender, block.timestamp);
    }

    function verifyDocument(bytes32 _docHash)
        external
        view
        returns (
            bool exists,
            address issuer,
            string memory metadata,
            uint256 timestamp,
            bool isActive
        )
    {
        DocumentInfo memory doc = documents[_docHash];
        exists = (doc.timestamp != 0);
        if (exists) {
            issuer = doc.issuer;
            metadata = doc.metadata;
            timestamp = doc.timestamp;
            isActive = doc.isActive;
        }
    }
}